import React, { useState } from 'react'
import axios from 'axios'


export default function CustomerForm({ onSaved }){
const [name,setName]=useState('');
const [phone,setPhone]=useState('');
const [address,setAddress]=useState('');


async function save(e){
e.preventDefault();
await axios.post('/api/customers', { name, phone, address });
setName(''); setPhone(''); setAddress('');
if(onSaved) onSaved();
}


return (
<form onSubmit={save} style={{ border:'1px solid #ddd', padding:12 }}>
<h3>إضافة عميل</h3>
<div><input placeholder='الاسم' value={name} onChange={e=>setName(e.target.value)} /></div>
<div><input placeholder='رقم الهاتف (WITH COUNTRY CODE, e.g. +2547...)' value={phone} onChange={e=>setPhone(e.target.value)} /></div>
<div><input placeholder='العنوان' value={address} onChange={e=>setAddress(e.target.value)} /></div>
<button type='submit'>حفظ</button>
</form>
)
}