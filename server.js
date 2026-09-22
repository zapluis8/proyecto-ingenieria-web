const express = require('express');

// Usamos 'mssql' porque Azure App Service funciona
// con Linux y no necesita mssql/msnodesqlv8.
const sql = require('mssql');

const multer = require('multer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;


// ============================================================
// CONEXIÓN A LA BASE DE DATOS
// ============================================================

const config = {
    // Estos datos se configurarán en Azure App Service
    // en Configuration > Environment variables.

    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,

    options: {
        // Azure SQL requiere conexión cifrada
        encrypt: true,

        // Azure utiliza un certificado válido
        trustServerCertificate: false
    }
};

// IMPORTANTE:
// Esta es la ÚNICA declaración de "conexion" en todo el archivo.
const conexion = sql.connect(config)
    .then(() => {
        console.log('Base de datos conectada');
    })
    .catch(err => {
        console.log(
            'No se pudo conectar al servidor:',
            err.message
        );

        // Volvemos a lanzar el error para que las rutas
        // puedan detectarlo correctamente.
        throw err;
    });


// ============================================================
// CONFIGURACIÓN DE EXPRESS
// ============================================================

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));


// ============================================================
// SESIONES
// ============================================================

app.use(session({
    secret: 'Taemins Store',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 4
    }
}));


// ============================================================
// GOOGLE OAUTH
// ============================================================

/*
   OAuth con Google.

   Solo se activa cuando existen:
   GOOGLE_CLIENT_ID
   GOOGLE_CLIENT_SECRET

   Para las pruebas normales se puede utilizar
   el login con correo y contraseña.
*/

if (
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
) {

    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,

                callbackURL:
                    process.env.GOOGLE_CALLBACK_URL ||
                    'http://localhost:3000/auth/google/callback'
            },

            async (accessToken, refreshToken, profile, done) => {

                try {

                    await conexion;

                    const correo =
                        profile.emails[0].value
                            .toLowerCase();

                    const existe = await sql.query`
                        SELECT *
                        FROM Usuarios
                        WHERE Correo=${correo}
                    `;

                    let usuario;

                    if (existe.recordset.length === 0) {

                        const nombre =
                            profile.name?.givenName ||
                            profile.displayName ||
                            'Usuario';

                        const apellidoP =
                            profile.name?.familyName ||
                            '';

                        const nuevo = await sql.query`
                            INSERT INTO Usuarios
                            (
                                Nombre,
                                ApellidoP,
                                ApellidoM,
                                Correo,
                                Contraseña,
                                RFC,
                                CURP,
                                Tipo
                            )
                            OUTPUT INSERTED.*
                            VALUES
                            (
                                ${nombre},
                                ${apellidoP},
                                '',
                                ${correo},
                                'OAuth',
                                '',
                                '',
                                'cliente'
                            )
                        `;

                        usuario = nuevo.recordset[0];

                    } else {

                        usuario = existe.recordset[0];

                    }

                    done(null, usuario);

                } catch (error) {

                    done(error);

                }
            }
        )
    );


    app.use(passport.initialize());
    app.use(passport.session());


    passport.serializeUser(
        (usuario, done) => {
            done(null, usuario.IdUsuario);
        }
    );


    passport.deserializeUser(
        async (id, done) => {

            try {

                const r = await sql.query`
                    SELECT *
                    FROM Usuarios
                    WHERE IdUsuario=${id}
                `;

                done(
                    null,
                    r.recordset[0]
                );

            } catch (error) {

                done(error);

            }
        }
    );


    app.get(
        '/auth/google',
        passport.authenticate(
            'google',
            {
                scope: ['profile', 'email']
            }
        )
    );


    app.get(
        '/auth/google/callback',

        passport.authenticate(
            'google',
            {
                failureRedirect: '/login.html'
            }
        ),

        (req, res) => {

            const u = req.user;

            delete u.Contraseña;

            req.session.usuario = u;

            res.redirect('/productos.html');
        }
    );
}


// ============================================================
// IMAGENES
// ============================================================

const storage = multer.diskStorage({

    destination: function (req, file, cb) {

        cb(
            null,
            path.join(
                __dirname,
                'public',
                'imagenes'
            )
        );
    },

    filename: function (req, file, cb) {

        const nombre =
            Date.now() +
            '-' +
            Math.round(Math.random() * 100000);

        cb(
            null,
            nombre +
            path.extname(file.originalname)
        );
    }
});


const upload = multer({
    storage: storage
});


// ============================================================
// FUNCIONES DE USUARIO
// ============================================================

function usuarioActual(req, res, next) {

    if (!req.session.usuario) {

        return res.status(401).json({
            error: 'Debes iniciar sesión.'
        });
    }

    next();
}


function permitir(...tipos) {

    return function (req, res, next) {

        if (!req.session.usuario) {

            return res.status(401).json({
                error: 'Debes iniciar sesión.'
            });
        }

        if (
            !tipos.includes(
                req.session.usuario.Tipo
            )
        ) {

            return res.status(403).json({
                error:
                    'No tienes permiso para esta operación.'
            });
        }

        next();
    };
}


function numeroValido(valor) {

    return valor !== undefined &&
           valor !== null &&
           valor !== '' &&
           !isNaN(Number(valor));
}


// ============================================================
// SESIÓN Y LOGIN
// ============================================================

app.get('/api/sesion', (req, res) => {

    if (req.session.usuario) {

        res.json({
            sesion: true,
            usuario: req.session.usuario
        });

    } else {

        res.json({
            sesion: false
        });

    }
});


app.post('/api/login', async (req, res) => {

    try {

        await conexion;

        const correo =
            String(
                req.body.correo || ''
            )
            .trim()
            .toLowerCase();

        const password =
            String(
                req.body.password || ''
            );


        if (!correo || !password) {

            return res.json({
                error:
                    'Escribe correo y contraseña.'
            });
        }


        const result = await sql.query`
            SELECT *
            FROM Usuarios
            WHERE Correo=${correo}
            AND Activo=1
        `;


        if (result.recordset.length === 0) {

            return res.json({
                error: 'Datos incorrectos.'
            });
        }


        const usuario =
            result.recordset[0];

        let correcta = false;


        if (
            usuario.Contraseña &&
            usuario.Contraseña.startsWith('$2')
        ) {

            correcta =
                await bcrypt.compare(
                    password,
                    usuario.Contraseña
                );

        } else {

            correcta =
                password === usuario.Contraseña;

        }


        if (!correcta) {

            return res.json({
                error: 'Datos incorrectos.'
            });
        }


        // Si la contraseña todavía estaba guardada
        // como texto, la convertimos a bcrypt.
        if (
            !usuario.Contraseña.startsWith('$2')
        ) {

            const hash =
                await bcrypt.hash(
                    password,
                    10
                );


            await sql.query`
                UPDATE Usuarios
                SET Contraseña=${hash}
                WHERE IdUsuario=${usuario.IdUsuario}
            `;
        }


        delete usuario.Contraseña;
        delete usuario.RFC;
        delete usuario.CURP;


        req.session.usuario = usuario;


        res.json({
            ok: true,
            usuario: usuario
        });


    } catch (err) {

        console.log(
            'Error en login:',
            err.message
        );

        res.status(500).json({
            error:
                'No se pudo iniciar sesión.'
        });
    }
});


app.post('/api/logout', (req, res) => {

    req.session.destroy(() => {

        res.json({
            ok: true
        });

    });
});


// ============================================================
// REGISTRO
// ============================================================

app.post('/api/registro', async (req, res) => {

    try {

        await conexion;

        const d = req.body;


        if (
            !d.nombre ||
            !d.apellidoP ||
            !d.apellidoM ||
            !d.correo ||
            !d.password ||
            !d.rfc ||
            !d.curp ||
            !d.calle ||
            !d.numExt ||
            !d.colonia ||
            !d.cp ||
            !d.municipio ||
            !d.ciudad ||
            !d.pais ||
            !d.titular ||
            !d.tarjeta ||
            !d.vencimiento ||
            !d.cvv
        ) {

            return res.json({
                error:
                    'Completa todos los campos obligatorios.'
            });
        }


        const correo =
            String(d.correo)
                .trim()
                .toLowerCase();


        const existe = await sql.query`
            SELECT IdUsuario
            FROM Usuarios
            WHERE Correo=${correo}
        `;


        if (existe.recordset.length > 0) {

            return res.json({
                error:
                    'Ese correo ya está registrado.'
            });
        }


        const hash =
            await bcrypt.hash(
                d.password,
                10
            );


        const transaction =
            new sql.Transaction();


        await transaction.begin();


        try {

            const usuario =
                await transaction
                    .request()

                    .input(
                        'Nombre',
                        sql.VarChar,
                        d.nombre
                    )

                    .input(
                        'ApellidoP',
                        sql.VarChar,
                        d.apellidoP
                    )

                    .input(
                        'ApellidoM',
                        sql.VarChar,
                        d.apellidoM
                    )

                    .input(
                        'Correo',
                        sql.VarChar,
                        correo
                    )

                    .input(
                        'Contraseña',
                        sql.VarChar,
                        hash
                    )

                    .input(
                        'RFC',
                        sql.VarChar,
                        d.rfc.toUpperCase()
                    )

                    .input(
                        'CURP',
                        sql.VarChar,
                        d.curp.toUpperCase()
                    )

                    .query(`
                        INSERT INTO Usuarios
                        (
                            Nombre,
                            ApellidoP,
                            ApellidoM,
                            Correo,
                            Contraseña,
                            RFC,
                            CURP,
                            Tipo
                        )
                        OUTPUT INSERTED.IdUsuario
                        VALUES
                        (
                            @Nombre,
                            @ApellidoP,
                            @ApellidoM,
                            @Correo,
                            @Contraseña,
                            @RFC,
                            @CURP,
                            'cliente'
                        )
                    `);


            const idUsuario =
                usuario.recordset[0]
                    .IdUsuario;


            await transaction
                .request()

                .input(
                    'IdUsuario',
                    sql.Int,
                    idUsuario
                )

                .input(
                    'Calle',
                    sql.VarChar,
                    d.calle
                )

                .input(
                    'NumExt',
                    sql.VarChar,
                    d.numExt
                )

                .input(
                    'NumInt',
                    sql.VarChar,
                    d.numInt || ''
                )

                .input(
                    'Colonia',
                    sql.VarChar,
                    d.colonia
                )

                .input(
                    'CP',
                    sql.VarChar,
                    d.cp
                )

                .input(
                    'Municipio',
                    sql.VarChar,
                    d.municipio
                )

                .input(
                    'Ciudad',
                    sql.VarChar,
                    d.ciudad
                )

                .input(
                    'Pais',
                    sql.VarChar,
                    d.pais
                )

                .query(`
                    INSERT INTO Direcciones
                    (
                        IdUsuario,
                        Calle,
                        NumExt,
                        NumInt,
                        Colonia,
                        CP,
                        Municipio,
                        Ciudad,
                        Pais,
                        Principal
                    )
                    VALUES
                    (
                        @IdUsuario,
                        @Calle,
                        @NumExt,
                        @NumInt,
                        @Colonia,
                        @CP,
                        @Municipio,
                        @Ciudad,
                        @Pais,
                        1
                    )
                `);


            await transaction
                .request()

                .input(
                    'IdUsuario',
                    sql.Int,
                    idUsuario
                )

                .input(
                    'Titular',
                    sql.VarChar,
                    d.titular
                )

                .input(
                    'Numero',
                    sql.VarChar,
                    d.tarjeta
                )

                .input(
                    'Vencimiento',
                    sql.VarChar,
                    d.vencimiento
                )

                .input(
                    'CVV',
                    sql.VarChar,
                    d.cvv
                )

                .query(`
                    INSERT INTO MetodoPago
                    (
                        IdUsuario,
                        Titular,
                        Numero,
                        Vencimiento,
                        CVV,
                        Principal
                    )
                    VALUES
                    (
                        @IdUsuario,
                        @Titular,
                        @Numero,
                        @Vencimiento,
                        @CVV,
                        1
                    )
                `);


            await transaction.commit();


            res.json({
                ok: true,
                mensaje:
                    'Usuario registrado correctamente.'
            });


        } catch (error) {

            await transaction.rollback();

            throw error;
        }


    } catch (err) {

        console.log(
            'Error en registro:',
            err.message
        );

        res.status(500).json({
            error:
                'No se pudo registrar el usuario.'
        });
    }
});


// ============================================================
// CATEGORIAS
// ============================================================

app.get('/api/categorias', async (req, res) => {

    try {

        await conexion;

        const result = await sql.query`
            SELECT *
            FROM Categorias
            ORDER BY Nombre
        `;

        res.json(
            result.recordset
        );

    } catch (err) {

        res.status(500).json({
            error:
                'No se pudieron cargar las categorías.'
        });
    }
});


app.post(
    '/api/categorias',
    permitir('admin'),
    async (req, res) => {

        try {

            const nombre =
                String(
                    req.body.nombre || ''
                ).trim();


            if (!nombre) {

                return res.json({
                    error:
                        'Escribe el nombre de la categoría.'
                });
            }


            await sql.query`
                INSERT INTO Categorias(Nombre)
                VALUES(${nombre})
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo guardar la categoría.'
            });
        }
    }
);


app.put(
    '/api/categorias/:id',
    permitir('admin'),
    async (req, res) => {

        try {

            const nombre =
                String(
                    req.body.nombre || ''
                ).trim();


            await sql.query`
                UPDATE Categorias
                SET Nombre=${nombre}
                WHERE IdCategoria=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo modificar la categoría.'
            });
        }
    }
);


app.delete(
    '/api/categorias/:id',
    permitir('admin'),
    async (req, res) => {

        try {

            const productos =
                await sql.query`
                    SELECT COUNT(*) AS Total
                    FROM Productos
                    WHERE IdCategoria=${req.params.id}
                `;


            if (
                productos.recordset[0].Total > 0
            ) {

                return res.json({
                    error:
                        'No puedes eliminar una categoría que tiene productos.'
                });
            }


            await sql.query`
                DELETE FROM Categorias
                WHERE IdCategoria=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo eliminar la categoría.'
            });
        }
    }
);


// ============================================================
// PRODUCTOS
// ============================================================

app.get('/api/productos', async (req, res) => {

    try {

        await conexion;

        const categoria =
            Number(
                req.query.categoria || 0
            );

        const buscar =
            String(
                req.query.buscar || ''
            ).trim();


        let result;


        if (
            categoria > 0 &&
            buscar
        ) {

            result = await sql.query`
                SELECT
                    p.*,
                    c.Nombre AS Categoria
                FROM Productos p
                INNER JOIN Categorias c
                    ON p.IdCategoria=c.IdCategoria
                WHERE p.IdCategoria=${categoria}
                AND p.Nombre LIKE ${'%' + buscar + '%'}
                ORDER BY p.IdProducto DESC
            `;


        } else if (categoria > 0) {

            result = await sql.query`
                SELECT
                    p.*,
                    c.Nombre AS Categoria
                FROM Productos p
                INNER JOIN Categorias c
                    ON p.IdCategoria=c.IdCategoria
                WHERE p.IdCategoria=${categoria}
                ORDER BY p.IdProducto DESC
            `;


        } else if (buscar) {

            result = await sql.query`
                SELECT
                    p.*,
                    c.Nombre AS Categoria
                FROM Productos p
                INNER JOIN Categorias c
                    ON p.IdCategoria=c.IdCategoria
                WHERE p.Nombre LIKE ${'%' + buscar + '%'}
                ORDER BY p.IdProducto DESC
            `;


        } else {

            result = await sql.query`
                SELECT
                    p.*,
                    c.Nombre AS Categoria
                FROM Productos p
                INNER JOIN Categorias c
                    ON p.IdCategoria=c.IdCategoria
                ORDER BY p.IdProducto DESC
            `;
        }


        res.json(
            result.recordset
        );


    } catch (err) {

        res.status(500).json({
            error:
                'No se pudieron cargar los productos.'
        });
    }
});


app.get(
    '/api/productos/:id',
    async (req, res) => {

        try {

            const result =
                await sql.query`
                    SELECT
                        p.*,
                        c.Nombre AS Categoria
                    FROM Productos p
                    INNER JOIN Categorias c
                        ON p.IdCategoria=c.IdCategoria
                    WHERE p.IdProducto=${req.params.id}
                `;


            if (
                result.recordset.length === 0
            ) {

                return res.status(404).json({
                    error:
                        'Producto no encontrado.'
                });
            }


            res.json(
                result.recordset[0]
            );


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo cargar el producto.'
            });
        }
    }
);


app.post(
    '/api/productos',
    permitir('admin'),
    async (req, res) => {

        try {

            const {
                nombre,
                precio,
                stock,
                categoria,
                fecha
            } = req.body;


            if (
                !nombre ||
                !numeroValido(precio) ||
                !numeroValido(stock) ||
                !categoria ||
                !fecha
            ) {

                return res.json({
                    error:
                        'Completa correctamente todos los datos del producto.'
                });
            }


            const result =
                await sql.query`
                    INSERT INTO Productos
                    (
                        Nombre,
                        Precio,
                        Stock,
                        IdCategoria,
                        FechaEnvio
                    )
                    OUTPUT INSERTED.IdProducto
                    VALUES
                    (
                        ${nombre},
                        ${Number(precio)},
                        ${Number(stock)},
                        ${Number(categoria)},
                        ${fecha}
                    )
                `;


            res.json({
                ok: true,
                idProducto:
                    result.recordset[0]
                        .IdProducto
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo guardar el producto.'
            });
        }
    }
);


app.put(
    '/api/productos/:id',
    permitir('admin', 'inventario'),
    async (req, res) => {

        try {

            const {
                nombre,
                precio,
                stock,
                categoria,
                fecha
            } = req.body;


            if (
                !nombre ||
                !numeroValido(precio) ||
                !numeroValido(stock) ||
                !categoria ||
                !fecha
            ) {

                return res.json({
                    error:
                        'Completa correctamente todos los datos.'
                });
            }


            await sql.query`
                UPDATE Productos
                SET
                    Nombre=${nombre},
                    Precio=${Number(precio)},
                    Stock=${Number(stock)},
                    IdCategoria=${Number(categoria)},
                    FechaEnvio=${fecha}
                WHERE IdProducto=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo modificar el producto.'
            });
        }
    }
);


app.delete(
    '/api/productos/:id',
    permitir('admin'),
    async (req, res) => {

        try {

            await sql.query`
                DELETE FROM Productos
                WHERE IdProducto=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo eliminar el producto. Puede tener pedidos relacionados.'
            });
        }
    }
);


// ============================================================
// IMAGENES
// ============================================================

app.get(
    '/api/imagenes/:id',
    async (req, res) => {

        try {

            const result =
                await sql.query`
                    SELECT *
                    FROM Imagenes
                    WHERE IdProducto=${req.params.id}
                    ORDER BY IdImagen
                `;


            res.json(
                result.recordset
            );


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron cargar las imágenes.'
            });
        }
    }
);


app.post(
    '/api/imagenes',
    permitir('admin', 'inventario'),
    upload.array('imagenes'),
    async (req, res) => {

        try {

            const idProducto =
                Number(
                    req.body.idProducto
                );


            if (
                !idProducto ||
                !req.files ||
                req.files.length === 0
            ) {

                return res.json({
                    error:
                        'Selecciona al menos una imagen.'
                });
            }


            for (
                const archivo of req.files
            ) {

                await sql.query`
                    INSERT INTO Imagenes
                    (
                        IdProducto,
                        Ruta
                    )
                    VALUES
                    (
                        ${idProducto},
                        ${archivo.filename}
                    )
                `;
            }


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron guardar las imágenes.'
            });
        }
    }
);


app.delete(
    '/api/imagenes/:id',
    permitir('admin', 'inventario'),
    async (req, res) => {

        try {

            await sql.query`
                DELETE FROM Imagenes
                WHERE IdImagen=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo eliminar la imagen.'
            });
        }
    }
);


// ============================================================
// CARRITO
// ============================================================

app.get(
    '/api/carrito',
    usuarioActual,
    async (req, res) => {

        try {

            const result =
                await sql.query`
                    SELECT
                        c.IdCarrito,
                        c.IdProducto,
                        c.Cantidad,
                        c.PrecioGuardado,
                        p.Nombre,
                        p.Stock
                    FROM Carrito c
                    INNER JOIN Productos p
                        ON c.IdProducto=p.IdProducto
                    WHERE c.IdUsuario=${req.session.usuario.IdUsuario}
                    ORDER BY c.IdCarrito
                `;


            res.json(
                result.recordset
            );


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo cargar el carrito.'
            });
        }
    }
);


app.post(
    '/api/carrito',
    permitir('cliente'),
    async (req, res) => {

        try {

            const idProducto =
                Number(
                    req.body.idProducto
                );

            const cantidad =
                Number(
                    req.body.cantidad
                );


            if (
                !idProducto ||
                !Number.isInteger(cantidad) ||
                cantidad < 1
            ) {

                return res.json({
                    error:
                        'Cantidad no válida.'
                });
            }


            const producto =
                await sql.query`
                    SELECT *
                    FROM Productos
                    WHERE IdProducto=${idProducto}
                `;


            if (
                producto.recordset.length === 0
            ) {

                return res.json({
                    error:
                        'Producto no encontrado.'
                });
            }


            const p =
                producto.recordset[0];


            const actual =
                await sql.query`
                    SELECT Cantidad
                    FROM Carrito
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                    AND IdProducto=${idProducto}
                `;


            const cantidadFinal =
                (
                    actual.recordset[0]?.Cantidad ||
                    0
                ) + cantidad;


            if (
                cantidadFinal > p.Stock
            ) {

                return res.json({
                    error:
                        'No hay suficiente stock para esa cantidad.'
                });
            }


            if (
                actual.recordset.length > 0
            ) {

                await sql.query`
                    UPDATE Carrito
                    SET
                        Cantidad=${cantidadFinal},
                        PrecioGuardado=${p.Precio}
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                    AND IdProducto=${idProducto}
                `;


            } else {

                await sql.query`
                    INSERT INTO Carrito
                    (
                        IdUsuario,
                        IdProducto,
                        Cantidad,
                        PrecioGuardado
                    )
                    VALUES
                    (
                        ${req.session.usuario.IdUsuario},
                        ${idProducto},
                        ${cantidad},
                        ${p.Precio}
                    )
                `;
            }


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo agregar al carrito.'
            });
        }
    }
);


app.put(
    '/api/carrito/:id',
    permitir('cliente'),
    async (req, res) => {

        try {

            const cantidad =
                Number(
                    req.body.cantidad
                );


            if (
                !Number.isInteger(cantidad) ||
                cantidad < 1
            ) {

                return res.json({
                    error:
                        'Cantidad no válida.'
                });
            }


            const item =
                await sql.query`
                    SELECT
                        c.IdProducto,
                        p.Stock
                    FROM Carrito c
                    INNER JOIN Productos p
                        ON c.IdProducto=p.IdProducto
                    WHERE c.IdCarrito=${req.params.id}
                    AND c.IdUsuario=${req.session.usuario.IdUsuario}
                `;


            if (
                item.recordset.length === 0
            ) {

                return res.json({
                    error:
                        'Producto no encontrado en el carrito.'
                });
            }


            if (
                cantidad >
                item.recordset[0].Stock
            ) {

                return res.json({
                    error:
                        'No hay suficiente stock.'
                });
            }


            await sql.query`
                UPDATE Carrito
                SET Cantidad=${cantidad}
                WHERE IdCarrito=${req.params.id}
                AND IdUsuario=${req.session.usuario.IdUsuario}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo actualizar el carrito.'
            });
        }
    }
);


app.delete(
    '/api/carrito/:id',
    permitir('cliente'),
    async (req, res) => {

        try {

            await sql.query`
                DELETE FROM Carrito
                WHERE IdCarrito=${req.params.id}
                AND IdUsuario=${req.session.usuario.IdUsuario}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo eliminar el producto del carrito.'
            });
        }
    }
);


// ============================================================
// DIRECCIONES Y PAGOS
// ============================================================

app.get(
    '/api/mis-datos',
    permitir('cliente'),
    async (req, res) => {

        try {

            const direcciones =
                await sql.query`
                    SELECT *
                    FROM Direcciones
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                `;


            const pagos =
                await sql.query`
                    SELECT
                        IdPago,
                        IdUsuario,
                        Titular,
                        Numero,
                        Vencimiento,
                        Principal
                    FROM MetodoPago
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                `;


            res.json({
                direcciones:
                    direcciones.recordset,

                pagos:
                    pagos.recordset
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron cargar tus datos.'
            });
        }
    }
);


app.post(
    '/api/direcciones',
    permitir('cliente'),
    async (req, res) => {

        try {

            const d = req.body;


            if (
                !d.calle ||
                !d.numExt ||
                !d.colonia ||
                !d.cp ||
                !d.municipio ||
                !d.ciudad ||
                !d.pais
            ) {

                return res.json({
                    error:
                        'Completa la dirección.'
                });
            }


            if (
                d.principal === true ||
                d.principal === 'true'
            ) {

                await sql.query`
                    UPDATE Direcciones
                    SET Principal=0
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                `;
            }


            await sql.query`
                INSERT INTO Direcciones
                (
                    IdUsuario,
                    Calle,
                    NumExt,
                    NumInt,
                    Colonia,
                    CP,
                    Municipio,
                    Ciudad,
                    Pais,
                    Principal
                )
                VALUES
                (
                    ${req.session.usuario.IdUsuario},
                    ${d.calle},
                    ${d.numExt},
                    ${d.numInt || ''},
                    ${d.colonia},
                    ${d.cp},
                    ${d.municipio},
                    ${d.ciudad},
                    ${d.pais},
                    ${d.principal ? 1 : 0}
                )
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo guardar la dirección.'
            });
        }
    }
);


app.post(
    '/api/pagos',
    permitir('cliente'),
    async (req, res) => {

        try {

            const p = req.body;


            if (
                !p.titular ||
                !p.numero ||
                !p.vencimiento ||
                !p.cvv
            ) {

                return res.json({
                    error:
                        'Completa el método de pago.'
                });
            }


            if (
                p.principal === true ||
                p.principal === 'true'
            ) {

                await sql.query`
                    UPDATE MetodoPago
                    SET Principal=0
                    WHERE IdUsuario=${req.session.usuario.IdUsuario}
                `;
            }


            await sql.query`
                INSERT INTO MetodoPago
                (
                    IdUsuario,
                    Titular,
                    Numero,
                    Vencimiento,
                    CVV,
                    Principal
                )
                VALUES
                (
                    ${req.session.usuario.IdUsuario},
                    ${p.titular},
                    ${p.numero},
                    ${p.vencimiento},
                    ${p.cvv},
                    ${p.principal ? 1 : 0}
                )
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo guardar el método de pago.'
            });
        }
    }
);


// ============================================================
// PEDIDOS / CHECKOUT
// ============================================================

app.post(
    '/api/pedidos',
    permitir('cliente'),
    async (req, res) => {

        const transaction =
            new sql.Transaction();


        try {

            const idDireccion =
                Number(
                    req.body.idDireccion
                );

            const idPago =
                Number(
                    req.body.idPago
                );


            if (
                !idDireccion ||
                !idPago
            ) {

                return res.json({
                    error:
                        'Selecciona dirección y método de pago.'
                });
            }


            const carrito =
                await sql.query`
                    SELECT
                        c.*,
                        p.Stock,
                        p.Nombre
                    FROM Carrito c
                    INNER JOIN Productos p
                        ON c.IdProducto=p.IdProducto
                    WHERE c.IdUsuario=${req.session.usuario.IdUsuario}
                `;


            if (
                carrito.recordset.length === 0
            ) {

                return res.json({
                    error:
                        'El carrito está vacío.'
                });
            }


            for (
                const item of carrito.recordset
            ) {

                if (
                    item.Cantidad >
                    item.Stock
                ) {

                    return res.json({
                        error:
                            'No hay suficiente stock de ' +
                            item.Nombre +
                            '.'
                    });
                }
            }


            const direccion =
                await sql.query`
                    SELECT IdDireccion
                    FROM Direcciones
                    WHERE IdDireccion=${idDireccion}
                    AND IdUsuario=${req.session.usuario.IdUsuario}
                `;


            const pago =
                await sql.query`
                    SELECT IdPago
                    FROM MetodoPago
                    WHERE IdPago=${idPago}
                    AND IdUsuario=${req.session.usuario.IdUsuario}
                `;


            if (
                direccion.recordset.length === 0 ||
                pago.recordset.length === 0
            ) {

                return res.json({
                    error:
                        'Los datos seleccionados no son válidos.'
                });
            }


            await transaction.begin();


            const pedido =
                await transaction
                    .request()

                    .input(
                        'IdUsuario',
                        sql.Int,
                        req.session.usuario.IdUsuario
                    )

                    .input(
                        'IdDireccion',
                        sql.Int,
                        idDireccion
                    )

                    .input(
                        'IdPago',
                        sql.Int,
                        idPago
                    )

                    .query(`
                        INSERT INTO Pedidos
                        (
                            IdUsuario,
                            IdDireccion,
                            IdPago,
                            Estado
                        )
                        OUTPUT INSERTED.IdPedido
                        VALUES
                        (
                            @IdUsuario,
                            @IdDireccion,
                            @IdPago,
                            'Pagada'
                        )
                    `);


            const idPedido =
                pedido.recordset[0]
                    .IdPedido;


            for (
                const item of carrito.recordset
            ) {

                await transaction
                    .request()

                    .input(
                        'IdPedido',
                        sql.Int,
                        idPedido
                    )

                    .input(
                        'IdProducto',
                        sql.Int,
                        item.IdProducto
                    )

                    .input(
                        'Cantidad',
                        sql.Int,
                        item.Cantidad
                    )

                    .input(
                        'Precio',
                        sql.Decimal(10, 2),
                        item.PrecioGuardado
                    )

                    .query(`
                        INSERT INTO DetallePedido
                        (
                            IdPedido,
                            IdProducto,
                            Cantidad,
                            Precio
                        )
                        VALUES
                        (
                            @IdPedido,
                            @IdProducto,
                            @Cantidad,
                            @Precio
                        )
                    `);


                await transaction
                    .request()

                    .input(
                        'IdProducto',
                        sql.Int,
                        item.IdProducto
                    )

                    .input(
                        'Cantidad',
                        sql.Int,
                        item.Cantidad
                    )

                    .query(`
                        UPDATE Productos
                        SET Stock=Stock-@Cantidad
                        WHERE IdProducto=@IdProducto
                    `);
            }


            await transaction
                .request()

                .input(
                    'IdUsuario',
                    sql.Int,
                    req.session.usuario.IdUsuario
                )

                .query(`
                    DELETE FROM Carrito
                    WHERE IdUsuario=@IdUsuario
                `);


            await transaction.commit();


            res.json({
                ok: true,
                idPedido: idPedido
            });


        } catch (err) {

            try {
                await transaction.rollback();
            } catch (_) {}


            res.status(500).json({
                error:
                    'No se pudo generar el pedido.'
            });
        }
    }
);


app.get(
    '/api/pedidos',
    usuarioActual,
    async (req, res) => {

        try {

            let result;


            if (
                req.session.usuario.Tipo === 'admin' ||
                req.session.usuario.Tipo === 'inventario'
            ) {

                result =
                    await sql.query`
                        SELECT
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre,
                            u.ApellidoP
                        FROM Pedidos p
                        INNER JOIN Usuarios u
                            ON p.IdUsuario=u.IdUsuario
                        ORDER BY p.Fecha DESC
                    `;


            } else {

                result =
                    await sql.query`
                        SELECT
                            IdPedido,
                            Fecha,
                            Estado
                        FROM Pedidos
                        WHERE IdUsuario=${req.session.usuario.IdUsuario}
                        ORDER BY Fecha DESC
                    `;
            }


            res.json(
                result.recordset
            );


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron cargar los pedidos.'
            });
        }
    }
);


app.put(
    '/api/pedidos/:id/estado',
    permitir('inventario', 'admin'),
    async (req, res) => {

        try {

            const estados = [
                'En proceso',
                'Pagada',
                'Enviado',
                'Recibido'
            ];


            if (
                !estados.includes(
                    req.body.estado
                )
            ) {

                return res.json({
                    error:
                        'Estado no válido.'
                });
            }


            await sql.query`
                UPDATE Pedidos
                SET Estado=${req.body.estado}
                WHERE IdPedido=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo cambiar el estado.'
            });
        }
    }
);


// ============================================================
// CALIFICACIONES Y COMENTARIOS
// ============================================================

app.get(
    '/api/productos/:id/opiniones',
    async (req, res) => {

        try {

            const cal =
                await sql.query`
                    SELECT
                        AVG(
                            CAST(
                                Estrellas AS DECIMAL(10,2)
                            )
                        ) AS Promedio,
                        COUNT(*) AS Total
                    FROM Calificaciones
                    WHERE IdProducto=${req.params.id}
                `;


            const comentarios =
                await sql.query`
                    SELECT
                        c.*,
                        u.Nombre,
                        u.ApellidoP
                    FROM Comentarios c
                    INNER JOIN Usuarios u
                        ON c.IdUsuario=u.IdUsuario
                    WHERE c.IdProducto=${req.params.id}
                    ORDER BY c.Fecha DESC
                `;


            res.json({
                promedio:
                    cal.recordset[0].Promedio || 0,

                total:
                    cal.recordset[0].Total,

                comentarios:
                    comentarios.recordset
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron cargar las opiniones.'
            });
        }
    }
);


async function comproProducto(
    idUsuario,
    idProducto
) {

    const result =
        await sql.query`
            SELECT d.IdDetalle
            FROM Pedidos p
            INNER JOIN DetallePedido d
                ON p.IdPedido=d.IdPedido
            WHERE p.IdUsuario=${idUsuario}
            AND d.IdProducto=${idProducto}
        `;


    return (
        result.recordset.length > 0
    );
}


app.post(
    '/api/opiniones',
    permitir('cliente'),
    async (req, res) => {

        try {

            const idProducto =
                Number(
                    req.body.idProducto
                );

            const estrellas =
                Number(
                    req.body.estrellas
                );

            const comentario =
                String(
                    req.body.comentario || ''
                ).trim();


            if (
                !idProducto ||
                estrellas < 0 ||
                estrellas > 5
            ) {

                return res.json({
                    error:
                        'Calificación no válida.'
                });
            }


            const compro =
                await comproProducto(
                    req.session.usuario.IdUsuario,
                    idProducto
                );


            if (!compro) {

                return res.json({
                    error:
                        'Solo puedes calificar un producto que hayas comprado.'
                });
            }


            await sql.query`
                MERGE Calificaciones AS destino

                USING
                (
                    SELECT
                        ${req.session.usuario.IdUsuario}
                        AS IdUsuario,

                        ${idProducto}
                        AS IdProducto
                )
                AS origen

                ON destino.IdUsuario=origen.IdUsuario
                AND destino.IdProducto=origen.IdProducto

                WHEN MATCHED THEN
                    UPDATE SET
                        Estrellas=${estrellas}

                WHEN NOT MATCHED THEN
                    INSERT
                    (
                        IdUsuario,
                        IdProducto,
                        Estrellas
                    )
                    VALUES
                    (
                        origen.IdUsuario,
                        origen.IdProducto,
                        ${estrellas}
                    );
            `;


            if (comentario) {

                await sql.query`
                    INSERT INTO Comentarios
                    (
                        IdUsuario,
                        IdProducto,
                        Comentario
                    )
                    VALUES
                    (
                        ${req.session.usuario.IdUsuario},
                        ${idProducto},
                        ${comentario}
                    )
                `;
            }


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo guardar la opinión.'
            });
        }
    }
);


// ============================================================
// USUARIOS - ADMIN
// ============================================================

app.get(
    '/api/usuarios',
    permitir('admin'),
    async (req, res) => {

        try {

            const result =
                await sql.query`
                    SELECT
                        IdUsuario,
                        Nombre,
                        ApellidoP,
                        ApellidoM,
                        Correo,
                        RFC,
                        CURP,
                        Tipo,
                        Activo
                    FROM Usuarios
                    ORDER BY IdUsuario
                `;


            res.json(
                result.recordset
            );


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudieron cargar los usuarios.'
            });
        }
    }
);


app.post(
    '/api/usuarios',
    permitir('admin'),
    async (req, res) => {

        try {

            const d = req.body;


            const hash =
                await bcrypt.hash(
                    d.password ||
                    'Usuario123',
                    10
                );


            await sql.query`
                INSERT INTO Usuarios
                (
                    Nombre,
                    ApellidoP,
                    ApellidoM,
                    Correo,
                    Contraseña,
                    RFC,
                    CURP,
                    Tipo
                )
                VALUES
                (
                    ${d.nombre},
                    ${d.apellidoP || ''},
                    ${d.apellidoM || ''},
                    ${d.correo.toLowerCase()},
                    ${hash},
                    ${d.rfc || ''},
                    ${d.curp || ''},
                    ${d.tipo}
                )
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo crear el usuario.'
            });
        }
    }
);


app.put(
    '/api/usuarios/:id',
    permitir('admin'),
    async (req, res) => {

        try {

            const d = req.body;


            await sql.query`
                UPDATE Usuarios
                SET
                    Nombre=${d.nombre},
                    ApellidoP=${d.apellidoP || ''},
                    ApellidoM=${d.apellidoM || ''},
                    Correo=${d.correo.toLowerCase()},
                    RFC=${d.rfc || ''},
                    CURP=${d.curp || ''},
                    Tipo=${d.tipo},
                    Activo=${d.activo ? 1 : 0}
                WHERE IdUsuario=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo modificar el usuario.'
            });
        }
    }
);


app.delete(
    '/api/usuarios/:id',
    permitir('admin'),
    async (req, res) => {

        try {

            if (
                Number(req.params.id) ===
                req.session.usuario.IdUsuario
            ) {

                return res.json({
                    error:
                        'No puedes eliminar tu propio usuario.'
                });
            }


            await sql.query`
                UPDATE Usuarios
                SET Activo=0
                WHERE IdUsuario=${req.params.id}
            `;


            res.json({
                ok: true
            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo desactivar el usuario.'
            });
        }
    }
);


// ============================================================
// REPORTES
// ============================================================

app.get(
    '/api/reportes/ventas',
    permitir('admin'),
    async (req, res) => {

        try {

            const mes =
                Number(
                    req.query.mes || 0
                );

            const dia =
                String(
                    req.query.dia || ''
                );


            let result;


            if (dia) {

                result =
                    await sql.query`
                        SELECT
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre AS Cliente,
                            SUM(d.Cantidad) AS Unidades,
                            SUM(
                                d.Cantidad*d.Precio
                            ) AS Total
                        FROM Pedidos p
                        INNER JOIN Usuarios u
                            ON p.IdUsuario=u.IdUsuario
                        INNER JOIN DetallePedido d
                            ON p.IdPedido=d.IdPedido
                        WHERE CAST(
                            p.Fecha AS DATE
                        )=${dia}
                        GROUP BY
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre
                        ORDER BY p.Fecha DESC
                    `;


            } else if (
                mes >= 1 &&
                mes <= 12
            ) {

                result =
                    await sql.query`
                        SELECT
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre AS Cliente,
                            SUM(d.Cantidad) AS Unidades,
                            SUM(
                                d.Cantidad*d.Precio
                            ) AS Total
                        FROM Pedidos p
                        INNER JOIN Usuarios u
                            ON p.IdUsuario=u.IdUsuario
                        INNER JOIN DetallePedido d
                            ON p.IdPedido=d.IdPedido
                        WHERE MONTH(p.Fecha)=${mes}
                        AND YEAR(p.Fecha)=YEAR(GETDATE())
                        GROUP BY
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre
                        ORDER BY p.Fecha DESC
                    `;


            } else {

                result =
                    await sql.query`
                        SELECT
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre AS Cliente,
                            SUM(d.Cantidad) AS Unidades,
                            SUM(
                                d.Cantidad*d.Precio
                            ) AS Total
                        FROM Pedidos p
                        INNER JOIN Usuarios u
                            ON p.IdUsuario=u.IdUsuario
                        INNER JOIN DetallePedido d
                            ON p.IdPedido=d.IdPedido
                        GROUP BY
                            p.IdPedido,
                            p.Fecha,
                            p.Estado,
                            u.Nombre
                        ORDER BY p.Fecha DESC
                    `;
            }


            const tipo =
                await sql.query`
                    SELECT TOP 1
                        c.Nombre AS Categoria,
                        SUM(d.Cantidad) AS Unidades
                    FROM DetallePedido d
                    INNER JOIN Pedidos p
                        ON d.IdPedido=p.IdPedido
                    INNER JOIN Productos pr
                        ON d.IdProducto=pr.IdProducto
                    INNER JOIN Categorias c
                        ON pr.IdCategoria=c.IdCategoria
                    WHERE YEAR(
                        p.Fecha
                    )=YEAR(GETDATE())
                    GROUP BY c.Nombre
                    ORDER BY
                        SUM(d.Cantidad) DESC
                `;


            res.json({

                ventas:
                    result.recordset,

                categoriaMasVendida:
                    tipo.recordset[0] ||
                    null

            });


        } catch (err) {

            res.status(500).json({
                error:
                    'No se pudo generar el reporte.'
            });
        }
    }
);


// ============================================================
// PAGINA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            'public',
            'index.html'
        )
    );
});


// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(
    PORT,
    () => {

        console.log(
            `Servidor iniciado en el puerto ${PORT}`
        );

    }
);
