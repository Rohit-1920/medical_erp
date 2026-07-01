import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2 } from 'lucide-react'
import { ordersApi } from '../api/orders'
import { organizationsApi } from '../api/organizations'
import { productsApi } from '../api/products'

interface Props { onClose: () => void }
interface LineItem { productId: string; quantity: number }

export default function NewOrderModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [distributorOrgId, setDistributorOrgId] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([{ productId:'', quantity:1 }])

  const { data: distributors } = useQuery({
    queryKey: ['organizations','DISTRIBUTOR'],
    queryFn: () => organizationsApi.getByType('DISTRIBUTOR'),
  })

  const { data: products } = useQuery({
    queryKey: ['products','byDistributor',distributorOrgId],
    queryFn: async () => { const res = await productsApi.list({ distributorId: distributorOrgId, size: 100 }); if (res.content.length > 0) return res; return productsApi.list({ size: 100 }); },
    enabled: !!distributorOrgId,
  })

  const mutation = useMutation({
    mutationFn: () => ordersApi.create({
      distributorOrgId, shippingAddress, notes:notes||undefined,
      items: items.filter(i=>i.productId&&i.quantity>0).map(i=>({productId:i.productId,quantity:i.quantity})),
    }),
    onSuccess: () => { queryClient.invalidateQueries({queryKey:['orders']}); onClose() },
    onError: (err:any) => setError(err?.response?.data?.detail??'Failed to create order'),
  })

  const handleSubmit = (e:React.FormEvent) => {
    e.preventDefault(); setError(null)
    if (!distributorOrgId) return setError('Please select a distributor')
    if (!shippingAddress) return setError('Please enter a shipping address')
    if (!items.some(i=>i.productId&&i.quantity>0)) return setError('Add at least one product')
    mutation.mutate()
  }

  const updateItem = (index:number, field:keyof LineItem, value:string|number) =>
    setItems(prev=>prev.map((it,i)=>i===index?{...it,[field]:value}:it))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">New Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="text-xs font-medium text-gray-600">Distributor *</label>
            <select id="distributorOrgId" className="form-input" value={distributorOrgId}
              onChange={e=>{setDistributorOrgId(e.target.value);setItems([{productId:'',quantity:1}])}}>
              <option value="">Select a distributor…</option>
              {distributors?.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Shipping Address *</label>
            <textarea id="shippingAddress" className="form-input" rows={2} value={shippingAddress}
              onChange={e=>setShippingAddress(e.target.value)}/>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <textarea id="notes" className="form-input" rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Items *</label>
              <button type="button" onClick={()=>setItems(p=>[...p,{productId:'',quantity:1}])}
                disabled={!distributorOrgId} className="text-blue-600 text-xs flex items-center gap-1 disabled:opacity-40">
                <Plus className="w-3 h-3"/> Add item</button>
            </div>
            {!distributorOrgId && <p className="text-xs text-gray-400">Select a distributor first to see their products.</p>}
            <div className="space-y-2">
              {items.map((item,idx)=>(
                <div key={idx} className="flex items-center gap-2">
                  <select className="form-input flex-1" value={item.productId}
                    onChange={e=>updateItem(idx,'productId',e.target.value)} disabled={!distributorOrgId}>
                    <option value="">Select product…</option>
                    {products?.content?.map(p=><option key={p.id} value={p.id}>{p.name} (₹{p.wholesalePrice})</option>)}
                  </select>
                  <input type="number" min={1} className="form-input w-20" value={item.quantity}
                    onChange={e=>updateItem(idx,'quantity',parseInt(e.target.value)||1)}/>
                  {items.length>1 && <button type="button" onClick={()=>setItems(p=>p.filter((_,i)=>i!==idx))}
                    className="text-red-500"><Trash2 className="w-4 h-4"/></button>}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {mutation.isPending?'Placing order…':'Place Order'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
