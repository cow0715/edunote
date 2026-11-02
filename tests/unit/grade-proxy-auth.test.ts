import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'
const state=vi.hoisted(()=>({getUser:vi.fn(),create:vi.fn()}))
vi.mock('@supabase/ssr',()=>({createServerClient:state.create}))
beforeEach(()=>{
 vi.clearAllMocks()
 state.getUser.mockResolvedValue({data:{user:null}})
 state.create.mockReturnValue({auth:{getUser:state.getUser}})
})
const path='/api/weeks/0551d990-412f-4035-ac10-f8a78d6e25c3/grade'
it('delegates grade POST authentication to the authenticated Route Handler exactly once',async()=>{
 const res=await proxy(new NextRequest('http://localhost'+path,{method:'POST',headers:{'x-user-id':'forged'}}))
 expect(res.headers.get('x-middleware-next')).toBe('1')
 expect(state.getUser).not.toHaveBeenCalled()
 expect(state.create).not.toHaveBeenCalled()
})
it.each([['GET',path],['PATCH',path],['POST',path+'/confirm'],['POST','/api/weeks/invalid/grade'],['GET','/dashboard']])('keeps existing proxy authentication for %s %s',async(method,url)=>{
 const res=await proxy(new NextRequest('http://localhost'+url,{method}))
 expect(state.getUser).toHaveBeenCalledOnce()
 expect(res.headers.get('location')).toBe('http://localhost/login')
})
it('leaves public share routing unchanged',async()=>{
 const res=await proxy(new NextRequest('http://localhost/share/test-token'))
 expect(state.getUser).toHaveBeenCalledOnce()
 expect(res.headers.get('x-middleware-next')).toBe('1')
})
