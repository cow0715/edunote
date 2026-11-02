import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { warmDatabaseConnection } from '@/lib/db/pool'
const state=vi.hoisted(()=>({pool:{totalCount:0,connect:vi.fn()},release:vi.fn(),attach:vi.fn(),on:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('pg',()=>({Pool:class{constructor(){return {...state.pool,on:state.on}}}}))
vi.mock('@vercel/functions',()=>({attachDatabasePool:state.attach}))
beforeEach(()=>{
 vi.clearAllMocks()
 delete (globalThis as {edunotePool?:unknown}).edunotePool
 state.pool.totalCount=0
 state.pool.connect.mockResolvedValue({release:state.release})
 vi.stubEnv('DATABASE_URL','postgresql://edunote_app.project:fixture@localhost:6543/postgres')
})
afterEach(()=>{vi.unstubAllEnvs();delete (globalThis as {edunotePool?:unknown}).edunotePool})
it('prepares one TLS-verified pool connection without a query or cached teacher identity',async()=>{
 await warmDatabaseConnection()
 expect(state.pool.connect).toHaveBeenCalledOnce()
 expect(state.release).toHaveBeenCalledOnce()
 expect(state.attach).toHaveBeenCalledOnce()
})
it('does not add connections while an existing connection is available or busy',async()=>{
 state.pool.totalCount=1
 await warmDatabaseConnection()
 expect(state.pool.connect).not.toHaveBeenCalled()
})
it('a connection failure cannot prevent the grade page from loading or leak credentials',async()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
 state.pool.connect.mockRejectedValue(new Error('secret connection string'))
 await expect(warmDatabaseConnection()).resolves.toBeUndefined()
 expect(JSON.stringify(warn.mock.calls)).not.toContain('secret')
 warn.mockRestore()
})
