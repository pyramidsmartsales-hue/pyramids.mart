import React from 'react'


export default function CustomersList({ customers }){
return (
<div style={{ marginTop:20 }}>
<h3>القائمة</h3>
<table style={{ width:'100%', borderCollapse:'collapse' }}>
<thead><tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th></tr></thead>
<tbody>
{customers.map(c=> (
<tr key={c.id}>
<td>{c.name}</td>
<td>{c.phone}</td>
<td>{c.address}</td>
</tr>
))}
</tbody>
</table>
</div>
)
}