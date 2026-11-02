import { beforeEach, expect, it, vi } from 'vitest'
import { getAuth } from '@/lib/api'
const state=vi.hoisted(()=>({getUser:vi.fn(),set:vi.fn(),getAll:vi.fn(),create:vi.fn()}))
vi.mock('next/headers',()=>({cookies:async()=>({getAll:state.getAll,set:state.set})}))
vi.mock('@supabase/ssr',()=>({createServerClient:state.create}))
beforeEach(()=>{
 vi.clearAllMocks()
 state.getAll.mockReturnValue([{name:'session',value:'expired-test-session'}])
 state.create.mockImplementation((_url,_key,options)=>({auth:{getUser:async()=>{
  options.cookies.getAll()
  options.cookies.setAll([{name:'session',value:'refreshed-test-session',options:{httpOnly:true,sameSite:'lax',secure:true}}])
  return state.getUser()
 }}}))
})
it('the Route Handler verifies the user and persists refreshed session cookies without proxy refresh',async()=>{
 state.getUser.mockResolvedValue({data:{user:{id:'verified-user'}}})
 expect((await getAuth()).user?.id).toBe('verified-user')
 expect(state.getUser).toHaveBeenCalledOnce()
 expect(state.set).toHaveBeenCalledWith('session','refreshed-test-session',{httpOnly:true,sameSite:'lax',secure:true})
})
it('does not accept an expired or revoked session as an authenticated user',async()=>{
 state.getUser.mockResolvedValue({data:{user:null},error:new Error('session revoked')})
 expect((await getAuth()).user).toBeNull()
 expect(state.getUser).toHaveBeenCalledOnce()
})
