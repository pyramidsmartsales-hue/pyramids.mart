import React, { useState, useEffect } from 'react'
import CustomerForm from './components/CustomerForm'
import CustomersList from './components/CustomersList'
import axios from 'axios'


export default function App(){
const [customers, setCustomers] = useState([])
const [text, setText] = useState('')
const [imageUrl, setImageUrl] = useState('')


useEffect(()=>{ fetchCustomers(); },[])


async function fetchCustomers(){
const r = await axios.get('/api/customers');
setCustomers(r.data);
}


async function sendToAll(){
const r = await axios.post('/api/send/to-all', { text, imageUrl });
alert('تم إرسال الطلب — راجع الـ console للمخرجات');
console.log(r.data);
}


return (
<div style={{ maxWidth:900, margin:'20px auto', fontFamily:'Arial' }}>
<h2>Dashboard العملاء</h2>
<CustomerForm onSaved={fetchCustomers} />


<div style={{ marginTop:20 }}>
<h3>اكتب الرسالة التي سترسلها</h3>
<textarea value={text} onChange={e=>setText(e.target.value)} rows={4} style={{ width:'100%' }} />
<p>Image URL (مثلاً Cloudinary):</p>
<input value={imageUrl} onChange={e=>setImageUrl(e.target.value)} style={{ width:'100%' }} />
<button onClick={sendToAll} style={{ marginTop:10 }}>إرسال للكل عبر واتساب</button>
</div>


<CustomersList customers={customers} />
</div>
)
}