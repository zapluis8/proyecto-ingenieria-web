// Muestra un mensaje en la página
function mensaje(id, texto, tipo = 'error') {

    const elemento = document.getElementById(id);

    if (!elemento) {
        return;
    }

    elemento.textContent = texto;
    elemento.className = 'mensaje ' + tipo;
}


// Revisa que la contraseña tenga el formato correcto
function validarPassword(idInput, idMensaje) {

    const input = document.getElementById(idInput);

    if (!input) {
        return;
    }

    // Revisa la contraseña mientras el usuario escribe
    input.addEventListener('input', function () {

        const regex =
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

        if (!regex.test(input.value)) {

            mensaje(
                idMensaje,
                'Mínimo 8 caracteres, una mayúscula, una minúscula y un número.'
            );

        } else {

            mensaje(
                idMensaje,
                'Contraseña válida.',
                'ok'
            );

        }

    });

}


// Revisa que el correo tenga un formato válido
function correoValido(valor) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor);

}


// Revisa que un número sea válido y no sea negativo
function numeroPositivo(valor) {

    return (
        valor !== '' &&
        !isNaN(valor) &&
        Number(valor) >= 0
    );

}


// Revisa que el código postal tenga 5 números
function codigoPostalValido(valor) {

    return /^\d{5}$/.test(valor);

}


// Revisa que la tarjeta tenga entre 13 y 19 números
function tarjetaValida(valor) {

    valor = valor.replace(/\s/g, '');

    return /^\d{13,19}$/.test(valor);

}


// Revisa que el CVV tenga 3 o 4 números
function cvvValido(valor) {

    return /^\d{3,4}$/.test(valor);

}


// Revisa que el RFC tenga un formato válido
function rfcValido(valor) {

    return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(
        valor.toUpperCase()
    );

}


// Revisa que la CURP tenga 18 caracteres
function curpValida(valor) {

    return /^[A-Z0-9]{18}$/.test(
        valor.toUpperCase()
    );

}
