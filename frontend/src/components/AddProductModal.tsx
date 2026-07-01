import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { productsApi } from '../api/products'
import { useAuthStore } from '../store/authStore'
import type { Product } from '../types'

interface Props { onClose: () => void }

const categories: Product['category'][] = ['MEDICINE','SURGICAL','DIAGNOSTIC','EQUIPMENT','CONSUMABLE','VACCINE']
const types: Product['type'][] = ['BRANDED','GENERIC']

export default function AddProductModal({ onClose }: Props) {
  const user = useAuthStore(s => s.user)
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    sku:'', name:'', genericName:'', description:'', manufacturer:'',
    category:'MEDICINE' as Product['category'], type:'GENERIC' as Product['type'],
    dosageForm:'', strength:'', unit:'', mrp:'', wholesalePrice:'',
    prescriptionRequired:false, controlledSubstance:false, hsnCode:'', gstRate:'',
  })

  const mutation = useMutation({
    mutationFn: () => productsApi.create({
      sku:form.sku, name:form.name, genericName:form.genericName||undefined,
      description:form.description||undefined, manufacturer:form.manufacturer,
      category:form.category, type:form.type, dosageForm:form.dosageForm||undefined,
      strength:form.strength||undefined, unit:form.unit, mrp:parseFloat(form.mrp),
      wholesalePrice:parseFloat(form.wholesalePrice), prescriptionRequired:form.prescriptionRequired,
      controlledSubstance:form.controlledSubstance, hsnCode:form.hsnCode||undefined,
      gstRate:form.gstRate?parseFloat(form.gstRate):undefined,
      distributorId:user?.organizationId??'',
    }),
    onSuccess: () => { queryClient.invalidateQueries({queryKey:['products']}); onClose() },
    onError: (err:any) => setError(err?.response?.data?.detail??'Failed to create product'),
  })

  const handleSubmit = (e:React.FormEvent) => {
    e.preventDefault(); setError(null)
    if (!form.sku||!form.name||!form.manufacturer||!form.unit||!form.mrp||!form.wholesalePrice)
      return setError('Please fill all required fields')
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-bold text-gray-900">Add Product</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-medium text-gray-600">SKU *</label>
              <input id="sku" name="sku" className="form-input" value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">Name *</label>
              <input id="name" name="name" className="form-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-medium text-gray-600">Generic Name</label>
              <input id="genericName" name="genericName" className="form-input" value={form.genericName} onChange={e=>setForm(f=>({...f,genericName:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">Manufacturer *</label>
              <input id="manufacturer" name="manufacturer" className="form-input" value={form.manufacturer} onChange={e=>setForm(f=>({...f,manufacturer:e.target.value}))}/></div>
          </div>
          <div><label className="text-xs font-medium text-gray-600">Description</label>
            <textarea id="description" name="description" className="form-input" rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-medium text-gray-600">Category *</label>
              <select id="category" name="category" className="form-input" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value as Product['category']}))}>
                {categories.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="text-xs font-medium text-gray-600">Type *</label>
              <select id="type" name="type" className="form-input" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value as Product['type']}))}>
                {types.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="text-xs font-medium text-gray-600">Dosage Form</label>
              <input id="dosageForm" name="dosageForm" className="form-input" value={form.dosageForm} onChange={e=>setForm(f=>({...f,dosageForm:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">Strength</label>
              <input id="strength" name="strength" className="form-input" value={form.strength} onChange={e=>setForm(f=>({...f,strength:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">Unit *</label>
              <input id="unit" name="unit" className="form-input" value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-medium text-gray-600">MRP (₹) *</label>
              <input id="mrp" name="mrp" type="number" step="0.01" className="form-input" value={form.mrp} onChange={e=>setForm(f=>({...f,mrp:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">Wholesale Price (₹) *</label>
              <input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" className="form-input" value={form.wholesalePrice} onChange={e=>setForm(f=>({...f,wholesalePrice:e.target.value}))}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs font-medium text-gray-600">HSN Code</label>
              <input id="hsnCode" name="hsnCode" className="form-input" value={form.hsnCode} onChange={e=>setForm(f=>({...f,hsnCode:e.target.value}))}/></div>
            <div><label className="text-xs font-medium text-gray-600">GST Rate (%)</label>
              <input id="gstRate" name="gstRate" type="number" step="0.01" className="form-input" value={form.gstRate} onChange={e=>setForm(f=>({...f,gstRate:e.target.value}))}/></div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input id="prescriptionRequired" name="prescriptionRequired" type="checkbox" checked={form.prescriptionRequired} onChange={e=>setForm(f=>({...f,prescriptionRequired:e.target.checked}))}/>
              Prescription Required</label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input id="controlledSubstance" name="controlledSubstance" type="checkbox" checked={form.controlledSubstance} onChange={e=>setForm(f=>({...f,controlledSubstance:e.target.checked}))}/>
              Controlled Substance</label>
          </div>
          <div className="flex justify-end gap-3 pt-3 border-t">
            <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
              {mutation.isPending?'Saving…':'Save Product'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
