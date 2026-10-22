import { z } from 'zod'
import { workerAccessToken } from '../pdf-import/gcp'
import { monthBounds } from './model'

export function billingQuery(table: string) {
  // Identifier cannot be a query parameter, so validate every component before interpolation.
  if (!/^[a-z][a-z0-9-]{4,62}\.[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error('invalid_billing_table')
  return `SELECT currency, SUM(cost + IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS amount FROM \`${table}\` WHERE usage_start_time >= @start AND usage_start_time < @end AND project.id = @project GROUP BY currency`
}
const queryResponse = z.object({ jobComplete: z.literal(true), errors: z.array(z.unknown()).optional(), rows: z.array(z.object({ f: z.tuple([z.object({ v: z.enum(['USD', 'KRW']) }), z.object({ v: z.string().regex(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/) })]) })) })
export async function fetchGcpCost(month: string) {
  const table = process.env.GCP_BILLING_EXPORT_TABLE!
  const query = billingQuery(table)
  const project = table.split('.')[0]
  const bounds = monthBounds(month)
  // Dedicated billing reader uses the existing keyless federation, not the worker runtime account.
  const token = await workerAccessToken({ audience: process.env.GCP_WORKLOAD_IDENTITY_AUDIENCE, serviceAccount: process.env.GCP_BILLING_SERVICE_ACCOUNT_EMAIL })
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    body: JSON.stringify({ query, useLegacySql: false, timeoutMs: 10000, maximumBytesBilled: '100000000',
      location: process.env.GCP_BILLING_LOCATION || 'asia-northeast3', parameterMode: 'NAMED',
      queryParameters: [
        { name: 'start', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: bounds.start } },
        { name: 'end', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: bounds.end } },
        { name: 'project', parameterType: { type: 'STRING' }, parameterValue: { value: process.env.GCP_PROJECT_ID } },
      ],
    }),
  })
  if (!response.ok) throw new Error('provider_read_failed')
  const result = queryResponse.parse(await response.json())
  if (result.errors?.length || result.rows.length !== 1) throw new Error('billing_data_unavailable')
  const row = result.rows[0].f
  const amount = Number(row[1].v)
  if (!Number.isFinite(amount)) throw new Error('invalid_amount')
  return { currency: row[0].v, amount }
}
