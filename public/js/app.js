// Esta función se usa para comunicarnos con el servidor
async function api(url, opciones = {}) {
    const respuesta = await fetch(url, opciones);
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || 'Ocurrió un error.');
    return datos;
}

// Sirve para pedir confirmación antes de hacer algo importante
function confirmarAccion(texto) {
    return confirm(texto);
}

// Muestra mensajes en la página
function mostrar(id, texto, tipo='ok') {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = texto;
    e.className = 'mensaje ' + tipo;
}

// Revisa si hay una sesión iniciada
async function sesion() {
    return await api('/api/sesion');
}

// Cierra la sesión del usuario
async function cerrarSesion() {
    await api('/api/logout', { method:'POST' });
    location.href = '/';
}

// Protege las páginas para que solo entren los usuarios permitidos
async function proteger(pagina) {
    const s = await sesion();
    if (!s.sesion) { location.href = '/login.html'; return null; }
    if (pagina && !pagina.includes(s.usuario.Tipo)) {
        location.href = '/'; return null;
    }
    return s.usuario;
}

// Inicia sesión con el correo y contraseña
async function login() {
    const correo = document.getElementById('correo').value.trim();
    const password = document.getElementById('password').value;

    if (!correoValido(correo)) return mostrar('mensaje', 'Escribe un correo válido.', 'error');
    if (!password) return mostrar('mensaje', 'Escribe tu contraseña.', 'error');

    try {
        const d = await api('/api/login', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({correo,password})
        });

        if (d.error) return mostrar('mensaje', d.error, 'error');

        // Dependiendo del tipo de usuario se abre una página diferente
        if (d.usuario.Tipo === 'admin') location.href='/admin.html';
        else if (d.usuario.Tipo === 'inventario') location.href='/inventario.html';
        else location.href='/productos.html';

    } catch(e) {
        mostrar('mensaje', e.message, 'error');
    }
}

// Registra un nuevo usuario
async function registrarUsuario() {
    const campos = ['nombre','apellidoP','apellidoM','correo','rfc','curp','password','calle','numExt','colonia','cp','municipio','ciudad','pais','titular','tarjeta','vencimiento','cvv'];

    // Primero revisamos que los campos tengan información
    for (const id of campos)
        if (!document.getElementById(id).value.trim())
            return mostrar('mensaje','Completa todos los campos obligatorios.','error');

    const correo = document.getElementById('correo').value.trim();
    const password = document.getElementById('password').value;

    if (!correoValido(correo))
        return mostrar('mensaje','El correo no tiene un formato válido.','error');

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password))
        return mostrar('mensaje','La contraseña no cumple el formato.','error');

    if (!/^\d{5}$/.test(document.getElementById('cp').value))
        return mostrar('mensaje','El CP debe tener 5 números.','error');

    if (!/^\d{13,19}$/.test(document.getElementById('tarjeta').value.replaceAll(' ','').trim()))
        return mostrar('mensaje','El número de tarjeta debe tener entre 13 y 19 números.','error');

    if (!/^\d{3,4}$/.test(document.getElementById('cvv').value))
        return mostrar('mensaje','El CVV debe tener 3 o 4 números.','error');

    // Aquí juntamos los datos para mandarlos al servidor
    const d = {};
    campos.forEach(id => d[id] = document.getElementById(id).value.trim());

    try {
        const r = await api('/api/registro',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(d)
        });

        if (r.error) return mostrar('mensaje',r.error,'error');

        mostrar('mensaje','Registro correcto. Ya puedes iniciar sesión.','ok');
        setTimeout(()=>location.href='/login.html',1200);

    } catch(e) {
        mostrar('mensaje',e.message,'error');
    }
}

// Carga las categorías que existen en la base de datos
async function cargarCategorias(selectId='categoria') {
    const lista = await api('/api/categorias');
    const select = document.getElementById(selectId);

    if (!select) return;

    select.innerHTML = '<option value="">Todas las categorías</option>';

    lista.forEach(c =>
        select.innerHTML += `<option value="${c.IdCategoria}">${c.Nombre}</option>`
    );
}

// Muestra los productos disponibles
async function cargarProductos() {
    const s = await sesion();
    const categoria = document.getElementById('filtroCategoria')?.value || '';
    const buscar = document.getElementById('buscar')?.value || '';

    const productos = await api(
        '/api/productos?categoria=' +
        encodeURIComponent(categoria) +
        '&buscar=' +
        encodeURIComponent(buscar)
    );

    const contenedor = document.getElementById('tabla');
    if (!contenedor) return;

    contenedor.innerHTML = '';

    for (const p of productos) {
        const imagenes = await api('/api/imagenes/'+p.IdProducto);
        const imagen = imagenes[0] ? '/imagenes/'+imagenes[0].Ruta : '';

        // Solo los clientes pueden agregar productos al carrito
        const boton = s.sesion && s.usuario.Tipo === 'cliente'
            ? `<button onclick="agregarCarrito(${p.IdProducto})">Agregar al carrito</button>`
            : '';

        contenedor.innerHTML += `<div class="product-card">
            ${imagen
                ? `<img src="${imagen}" alt="${p.Nombre}">`
                : '<div style="height:180px;background:#e2e8f0;border-radius:10px;display:flex;align-items:center;justify-content:center">Sin imagen</div>'}

            <h3>${p.Nombre}</h3>
            <span class="tag">${p.Categoria}</span>
            <p class="precio">$${Number(p.Precio).toFixed(2)}</p>
            <p>Stock disponible: ${p.Stock}</p>
            <p>Entrega: ${p.FechaEnvio}</p>
            <a href="producto.html?id=${p.IdProducto}">Ver producto</a>
            ${boton}
        </div>`;
    }
}

// Agrega un producto al carrito
async function agregarCarrito(idProducto) {
    const cantidad = Number(prompt('¿Cuántas unidades quieres?', '1'));

    if (!cantidad || cantidad < 1) return;

    try {
        const r = await api('/api/carrito',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({idProducto,cantidad})
        });

        alert(r.error || 'Producto agregado al carrito.');

    } catch(e) {
        alert(e.message);
    }
}

// Carga los productos que tiene el usuario en su carrito
async function cargarCarrito() {
    const usuario = await proteger('cliente');
    if (!usuario) return;

    const items = await api('/api/carrito');
    const tabla = document.getElementById('tabla');
    tabla.innerHTML='';

    let total=0;

    items.forEach(i=>{
        const subtotal=Number(i.PrecioGuardado)*i.Cantidad;
        total+=subtotal;

        tabla.innerHTML += `<tr>
            <td>${i.Nombre}</td>
            <td>$${Number(i.PrecioGuardado).toFixed(2)}</td>
            <td>
                <input type="number" min="1" max="${i.Stock}" value="${i.Cantidad}"
                onchange="actualizarCarrito(${i.IdCarrito},this.value)">
            </td>
            <td>$${subtotal.toFixed(2)}</td>
            <td>
                <button class="btn-danger"
                onclick="eliminarCarrito(${i.IdCarrito})">Eliminar</button>
            </td>
        </tr>`;
    });

    document.getElementById('total').textContent='Total: $'+total.toFixed(2);
}

// Cambia la cantidad de un producto del carrito
async function actualizarCarrito(id,cantidad){
    const r=await api('/api/carrito/'+id,{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({cantidad:Number(cantidad)})
    });

    if(r.error) alert(r.error);
    await cargarCarrito();
}

// Elimina un producto del carrito
async function eliminarCarrito(id){
    if(!confirmarAccion('¿Eliminar este producto del carrito?')) return;

    await api('/api/carrito/'+id,{method:'DELETE'});
    await cargarCarrito();
}

// Carga las direcciones y métodos de pago del usuario
async function cargarCheckout(){
    const usuario=await proteger('cliente');
    if(!usuario)return;

    const d=await api('/api/mis-datos');
    const sd=document.getElementById('direccion');
    const sp=document.getElementById('pago');

    sd.innerHTML='';
    sp.innerHTML='';

    d.direcciones.forEach(x=>
        sd.innerHTML+=`<option value="${x.IdDireccion}">
            ${x.Calle} ${x.NumExt}, ${x.Colonia}, ${x.Ciudad}
            ${x.Principal?' (Principal)':''}
        </option>`
    );

    d.pagos.forEach(x=>
        sp.innerHTML+=`<option value="${x.IdPago}">
            ${x.Titular} - ****${x.Numero.slice(-4)}
            ${x.Principal?' (Principal)':''}
        </option>`
    );
}

// Confirma la compra y crea el pedido
async function hacerPedido(){
    if(!confirmarAccion('¿Confirmar el pago simulado y generar el pedido?'))
        return;

    const r=await api('/api/pedidos',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            idDireccion:document.getElementById('direccion').value,
            idPago:document.getElementById('pago').value
        })
    });

    if(r.error)
        return mostrar('mensaje',r.error,'error');

    mostrar('mensaje','Compra realizada. Pedido #'+r.idPedido,'ok');

    setTimeout(()=>location.href='/pedido.html',1000);
}

// Muestra los pedidos que ha hecho el cliente
async function cargarPedido(){
    const u=await proteger('cliente');
    if(!u)return;

    const pedidos=await api('/api/pedidos');
    const t=document.getElementById('tabla');
    t.innerHTML='';

    pedidos.forEach(p=>
        t.innerHTML+=`<tr>
            <td>${p.IdPedido}</td>
            <td>${new Date(p.Fecha).toLocaleString()}</td>
            <td>${p.Estado}</td>
        </tr>`
    );
}

// Muestra la información de un producto
async function cargarProducto(){
    const id=new URLSearchParams(location.search).get('id') || '1';

    const p=await api('/api/productos/'+id);
    const imagenes=await api('/api/imagenes/'+id);
    const op=await api('/api/productos/'+id+'/opiniones');

    document.getElementById('titulo').textContent=p.Nombre;
    document.getElementById('precio').textContent='$'+Number(p.Precio).toFixed(2);
    document.getElementById('categoria').textContent=p.Categoria;
    document.getElementById('entrega').textContent=p.FechaEnvio;
    document.getElementById('idProducto').value=id;

    // Carga las imágenes del producto
    const gal=document.getElementById('galeria');
    gal.innerHTML='';

    imagenes.forEach((im,i)=>
        gal.innerHTML+=`<img class="mini-img"
        src="/imagenes/${im.Ruta}"
        onclick="document.getElementById('principal').src=this.src">`
    );

    if(imagenes[0])
        document.getElementById('principal').src='/imagenes/'+imagenes[0].Ruta;

    // Muestra la calificación y los comentarios
    document.getElementById('promedio').textContent=
        'Promedio: '+Number(op.promedio).toFixed(1)+' / 5';

    document.getElementById('comentarios').innerHTML=
        op.comentarios.map(c=>
            `<div class="card">
                <b>${c.Nombre} ${c.ApellidoP}</b>
                <p>${c.Comentario}</p>
            </div>`
        ).join('') || '<p>No hay recomendaciones todavía.</p>';
}

// Guarda una opinión sobre un producto
async function guardarOpinion(){
    const id=Number(document.getElementById('idProducto').value);
    const estrellas=Number(document.getElementById('estrellas').value);
    const comentario=document.getElementById('comentario').value.trim();

    const r=await api('/api/opiniones',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({idProducto:id,estrellas,comentario})
    });

    alert(r.error || 'Opinión guardada.');

    if(!r.error)
        cargarProducto();
}

// Sube imágenes de un producto
async function subirImagen(){
    const id=document.getElementById('idProducto').value;
    const files=document.getElementById('imagenes').files;

    if(!files.length)
        return alert('Selecciona imágenes.');

    const fd=new FormData();
    fd.append('idProducto',id);

    for(const f of files)
        fd.append('imagenes',f);

    const r=await api('/api/imagenes',{
        method:'POST',
        body:fd
    });

    alert(r.error||'Imágenes guardadas.');

    if(!r.error)
        location.reload();
}


/* ADMIN */

// Carga los productos para que el administrador pueda modificarlos
async function cargarAdminProductos(){
    const u=await proteger('admin');
    if(!u)return;

    await cargarCategorias('categoria');

    const productos=await api('/api/productos');
    const t=document.getElementById('tabla');
    t.innerHTML='';

    productos.forEach(p=>
        t.innerHTML+=`<tr>
            <td>${p.IdProducto}</td>
            <td>${p.Nombre}</td>
            <td>$${Number(p.Precio).toFixed(2)}</td>
            <td>${p.Stock}</td>
            <td>${p.Categoria}</td>
            <td>${p.FechaEnvio}</td>
            <td class="acciones">
                <button onclick="editarProducto(${p.IdProducto})">Editar</button>
                <button class="btn-danger" onclick="borrarProducto(${p.IdProducto})">Eliminar</button>
            </td>
        </tr>`
    );
}

// Guarda un producto nuevo o uno que estamos editando
async function guardarProducto(){
    const datos={
        nombre:val('nombre'),
        precio:val('precio'),
        stock:val('stock'),
        categoria:val('categoria'),
        fecha:val('fecha')
    };

    if(!datos.nombre || !numeroPositivo(datos.precio) ||
       !numeroPositivo(datos.stock) || !datos.categoria || !datos.fecha)
        return mostrar('mensaje','Completa correctamente los datos.','error');

    const id=val('idProducto');

    const r=await api(
        id ? '/api/productos/'+id : '/api/productos',
        {
            method:id?'PUT':'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(datos)
        }
    );

    if(r.error)
        return mostrar('mensaje',r.error,'error');

    mostrar('mensaje','Producto guardado.','ok');

    document.getElementById('formProducto').reset();
    document.getElementById('idProducto').value='';
    cargarAdminProductos();
}

// Carga los datos de un producto para poder editarlo
async function editarProducto(id){
    const p=await api('/api/productos/'+id);

    ['nombre','precio','stock','categoria','fecha'].forEach(x=>
        document.getElementById(x).value=
        p[x==='categoria'?'IdCategoria':x==='fecha'?'FechaEnvio':x]
    );

    document.getElementById('idProducto').value=id;
}

// Elimina un producto
async function borrarProducto(id){
    if(!confirmarAccion('¿Eliminar este producto?'))return;

    const r=await api('/api/productos/'+id,{method:'DELETE'});

    if(r.error)return alert(r.error);

    cargarAdminProductos();
}

// Carga las categorías para el administrador
async function cargarCategoriasAdmin(){
    const u=await proteger('admin');
    if(!u)return;

    const lista=await api('/api/categorias');
    const t=document.getElementById('tabla');
    t.innerHTML='';

    lista.forEach(c=>
        t.innerHTML+=`<tr>
            <td>${c.IdCategoria}</td>
            <td>${c.Nombre}</td>
            <td class="acciones">
                <button onclick="editarCategoria(${c.IdCategoria},'${c.Nombre.replaceAll("'","\\'")}')">Editar</button>
                <button class="btn-danger" onclick="borrarCategoria(${c.IdCategoria})">Eliminar</button>
            </td>
        </tr>`
    );
}

// Guarda una categoría nueva o editada
async function guardarCategoria(){
    const id=val('idCategoria');
    const nombre=val('nombre');

    if(!nombre)
        return alert('Escribe un nombre.');

    const r=await api(
        id ? '/api/categorias/'+id : '/api/categorias',
        {
            method:id?'PUT':'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({nombre})
        }
    );

    if(r.error)return alert(r.error);

    document.getElementById('formCategoria').reset();
    cargarCategoriasAdmin();
}

// Pone los datos de una categoría en el formulario
function editarCategoria(id,nombre){
    document.getElementById('idCategoria').value=id;
    document.getElementById('nombre').value=nombre;
}

// Elimina una categoría
async function borrarCategoria(id){
    if(!confirmarAccion('¿Eliminar esta categoría?'))return;

    const r=await api('/api/categorias/'+id,{method:'DELETE'});

    if(r.error)return alert(r.error);

    cargarCategoriasAdmin();
}

// Carga los usuarios para el administrador
async function cargarUsuarios(){
    const u=await proteger('admin');
    if(!u)return;

    const lista=await api('/api/usuarios');
    const t=document.getElementById('tabla');
    t.innerHTML='';

    lista.forEach(x=>
        t.innerHTML+=`<tr>
            <td>${x.IdUsuario}</td>
            <td>${x.Nombre} ${x.ApellidoP}</td>
            <td>${x.Correo}</td>
            <td>${x.Tipo}</td>
            <td>${x.Activo?'Activo':'Inactivo'}</td>
            <td class="acciones">
                <button onclick="editarUsuario(${x.IdUsuario})">Editar</button>
                <button class="btn-danger" onclick="borrarUsuario(${x.IdUsuario})">Desactivar</button>
            </td>
        </tr>`
    );
}

// Guarda o modifica un usuario
async function guardarUsuario(){
    const d={
        nombre:val('nombre'),
        apellidoP:val('apellidoP'),
        apellidoM:val('apellidoM'),
        correo:val('correo'),
        rfc:val('rfc'),
        curp:val('curp'),
        tipo:val('tipo'),
        password:val('password')
    };

    if(!d.nombre || !correoValido(d.correo) || !d.tipo)
        return alert('Completa los datos.');

    const id=val('idUsuario');

    const r=await api(
        id ? '/api/usuarios/'+id : '/api/usuarios',
        {
            method:id?'PUT':'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...d,activo:true})
        }
    );

    if(r.error)return alert(r.error);

    document.getElementById('formUsuario').reset();
    document.getElementById('idUsuario').value='';
    cargarUsuarios();
}

// Busca un usuario para editarlo
async function editarUsuario(id){
    const lista=await api('/api/usuarios');
    const u=lista.find(x=>x.IdUsuario===id);

    if(!u)return;

    ['nombre','apellidoP','apellidoM','correo','rfc','curp','tipo'].forEach(x=>
        document.getElementById(x).value=u[x==='tipo'?'Tipo':x]
    );

    document.getElementById('idUsuario').value=id;
}

// Desactiva un usuario
async function borrarUsuario(id){
    if(!confirmarAccion('¿Desactivar este usuario?'))return;

    const r=await api('/api/usuarios/'+id,{method:'DELETE'});

    if(r.error)return alert(r.error);

    cargarUsuarios();
}


/* INVENTARIO */

// Carga los productos que puede revisar el encargado de inventario
async function cargarInventario(){
    const u=await proteger('inventario');
    if(!u)return;

    const buscar=val('buscar');
    const productos=await api('/api/productos?buscar='+encodeURIComponent(buscar));

    const t=document.getElementById('tabla');
    t.innerHTML='';

    productos.forEach(p=>
        t.innerHTML+=`<tr>
            <td>${p.IdProducto}</td>
            <td>${p.Nombre}</td>
            <td>${p.Precio}</td>
            <td>${p.Stock}</td>
            <td>${p.Categoria}</td>
            <td>
                <button onclick="editarInventario(${p.IdProducto})">Modificar</button>
            </td>
        </tr>`
    );
}

// Permite cambiar precio, stock y fecha de entrega
async function editarInventario(id){
    const p=await api('/api/productos/'+id);

    const precio=prompt('Nuevo precio:',p.Precio);
    if(precio===null)return;

    const stock=prompt('Nuevo stock:',p.Stock);
    if(stock===null)return;

    const fecha=prompt('Entrega:',p.FechaEnvio);
    if(fecha===null)return;

    const r=await api('/api/productos/'+id,{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            nombre:p.Nombre,
            precio:Number(precio),
            stock:Number(stock),
            categoria:p.IdCategoria,
            fecha
        })
    });

    if(r.error)return alert(r.error);

    cargarInventario();
}

// Muestra los pedidos para el área de inventario
async function cargarVentas(){
    const u=await proteger('inventario');
    if(!u)return;

    const lista=await api('/api/pedidos');
    const t=document.getElementById('tabla');
    t.innerHTML='';

    lista.forEach(p=>
        t.innerHTML+=`<tr>
            <td>${p.IdPedido}</td>
            <td>${p.Nombre||''} ${p.ApellidoP||''}</td>
            <td>${new Date(p.Fecha).toLocaleString()}</td>
            <td>${p.Estado}</td>
            <td>
                <select onchange="cambiarEstado(${p.IdPedido},this.value)">
                    <option>En proceso</option>
                    <option>Pagada</option>
                    <option>Enviado</option>
                    <option>Recibido</option>
                </select>
            </td>
        </tr>`
    );
}

// Cambia el estado de un pedido
async function cambiarEstado(id,estado){
    if(!confirmarAccion('¿Cambiar el estado del pedido?'))return;

    const r=await api('/api/pedidos/'+id+'/estado',{
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({estado})
    });

    if(r.error)alert(r.error);
}


/* REPORTES */

// Genera el reporte de ventas
async function cargarReportes(){
    const u=await proteger('admin');
    if(!u)return;

    generarReporte();
}

async function generarReporte(){
    const mes=val('mes');
    const dia=val('dia');

    const r=await api(
        '/api/reportes/ventas?mes=' +
        encodeURIComponent(mes) +
        '&dia=' +
        encodeURIComponent(dia)
    );

    const t=document.getElementById('tabla');
    t.innerHTML='';

    r.ventas.forEach(v=>
        t.innerHTML+=`<tr>
            <td>${v.IdPedido}</td>
            <td>${v.Cliente}</td>
            <td>${new Date(v.Fecha).toLocaleString()}</td>
            <td>${v.Estado}</td>
            <td>${v.Unidades}</td>
            <td>$${Number(v.Total).toFixed(2)}</td>
        </tr>`
    );

    document.getElementById('categoriaMasVendida').textContent =
        r.categoriaMasVendida
        ? 'Categoría más vendida del año: ' +
          r.categoriaMasVendida.Categoria +
          ' (' + r.categoriaMasVendida.Unidades + ' unidades)'
        : 'Todavía no hay ventas.';
}


/* PERFIL DEL CLIENTE */

// Muestra las direcciones y métodos de pago del cliente
async function cargarPerfil(){
    const u=await proteger('cliente');
    if(!u)return;

    const d=await api('/api/mis-datos');

    const td=document.getElementById('direcciones');

    td.innerHTML=d.direcciones.map(x=>
        `<li>${x.Calle} ${x.NumExt}, ${x.Colonia}, ${x.Ciudad}
        ${x.Principal?'(Principal)':''}</li>`
    ).join('');

    const tp=document.getElementById('pagos');

    tp.innerHTML=d.pagos.map(x=>
        `<li>${x.Titular} - ****${x.Numero.slice(-4)}
        ${x.Principal?'(Principal)':''}</li>`
    ).join('');
}

// Agrega una nueva dirección
async function agregarDireccion(){
    const d={
        calle:val('calle'),
        numExt:val('numExt'),
        numInt:val('numInt'),
        colonia:val('colonia'),
        cp:val('cp'),
        municipio:val('municipio'),
        ciudad:val('ciudad'),
        pais:val('pais'),
        principal:document.getElementById('principalDir').checked
    };

    const r=await api('/api/direcciones',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(d)
    });

    alert(r.error||'Dirección guardada.');

    if(!r.error)
        cargarPerfil();
}

// Agrega un método de pago
async function agregarPago(){
    const d={
        titular:val('titular'),
        numero:val('tarjeta'),
        vencimiento:val('vencimiento'),
        cvv:val('cvv'),
        principal:document.getElementById('principalPago').checked
    };

    const r=await api('/api/pagos',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(d)
    });

    alert(r.error||'Método guardado.');

    if(!r.error)
        cargarPerfil();
}

// Esta función nos ayuda a obtener el valor de un campo
function val(id){
    return document.getElementById(id)?.value.trim()||'';
}
