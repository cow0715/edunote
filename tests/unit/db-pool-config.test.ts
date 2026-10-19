import { expect, it } from 'vitest'
import { poolConfig } from '@/lib/db/pool-config'

it('requires the dedicated pooler account instead of a privileged postgres login', () => {
  expect(() => poolConfig()).toThrow()
  expect(() => poolConfig('postgresql://postgres:fixture@localhost:6543/postgres')).toThrow()
  expect(() => poolConfig('postgresql://edunote_app.project:fixture@localhost:5432/postgres')).toThrow()
})
it('prevents URL query parameters from weakening TLS or changing the role', () => {
  const options = poolConfig('postgresql://edunote_app.project:fixture@localhost:6543/postgres?ssl=false&sslmode=disable&user=postgres', 'line1\\nline2')
  expect(new URL(options.connectionString!).search).toBe('')
  expect(options.ssl).toEqual({ rejectUnauthorized: true, ca: 'line1\nline2' })
})
