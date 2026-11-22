//////////////////// Imports ////////////////////
import { PublicKey } from "@solana/web3.js";

////////////////// Constantes ////////////////////
const nombre_negocio = "Abarrotes Tsting"; // Nombre del punto de venta
const owner = pg.wallet.publicKey; // Wallet

//////////////////// Client Test Logs ////////////////////
console.log("My address:", owner.toString()); // Ver el address
const balance = await pg.connection.getBalance(owner);
console.log(`My balance: ${balance / web3.LAMPORTS_PER_SOL} SOL`); // Ver la cantidad de tokens de solana

//////////////////// OBTENER PDAs ////////////////////
/*
Un PDA representa una cuenta controlada por un programa. Su caracteristica principal es no contar con
una clave privada con la cual firmar: en su lugar emplea direcciones generadas deterministicamente,
es decir, recreables a partir de semillas. Por eso, para llamar una instruccion desde el cliente hay
que reproducir las semillas en su orden y tipo correspondiente.

Aqui las semillas siguen la jerarquia del modelo. Cada cuenta se deriva de su padre:

    registro  <- ["registro", nombre_negocio, owner]
    cliente   <- ["cliente",  registro, id_cliente]
    venta     <- ["venta",    cliente,  sku]

para llegar a una venta hay que derivar primero el registro y luego el
cliente. Esa cadena es la misma que el programa valida en el contexto de cada instruccion.
*/

//////////////////// Helper: u16 a bytes ////////////////////
/*
En Rust las seeds numericas se escriben con id_cliente.to_le_bytes(): little endian y 2 bytes para
un u16. Aqui hay que replicarlo byte por byte. Si usaras Buffer.from([id]) o Buffer.from(String(id))
la direccion derivada no coincide y Anchor falla con ConstraintSeeds (formato de las semillas no coinciden).
*/
function u16ToBytes(valor) {
  const buffer = Buffer.alloc(2); // Un u16 son 2 bytes
  buffer.writeUInt16LE(valor, 0); // LE = little endian, igual que to_le_bytes() en Rust
  return buffer;
}

//////////////////// Registro ////////////////////
function pdaRegistro(nombre_negocio) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("registro"), // Semilla 1: b"registro"
      Buffer.from(nombre_negocio), // Semilla 2: nombre del negocio -> String
      owner.toBuffer(), // Semilla 3: wallet -> Pubkey
    ],
    pg.PROGRAM_ID // Program ID: siempre va al final
  );
}

//////////////////// Cliente ////////////////////
// depende del registro
function pdaCliente(pda_registro, id_cliente) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("cliente"), // Semilla 1: b"cliente"
      pda_registro.toBuffer(), // Semilla 2: cuenta padre -> Pubkey
      u16ToBytes(id_cliente), // Semilla 3: id del cliente -> u16 little endian
    ],
    pg.PROGRAM_ID
  );
}

//////////////////// Venta ////////////////////
// depende del cliente. El SKU en las semillas impide que un cliente repita el mismo producto
function pdaVenta(pda_cliente, sku) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("venta"), // Semilla 1: b"venta"
      pda_cliente.toBuffer(), // Semilla 2: cuenta padre -> Pubkey
      Buffer.from(sku), // Semilla 3: sku del producto -> String
    ],
    pg.PROGRAM_ID
  );
}

//////////////////// Helper: la cadena completa ////////////////////
// Las cuatro instrucciones que tocan una venta necesitan las tres cuentas, porque el programa
// valida la cadena en el contexto. Derivarlas en un solo lugar evita repetir el mismo bloque.
function cadena(nombre_negocio, id_cliente, sku) {
  const [registro] = pdaRegistro(nombre_negocio);
  const [cliente] = pdaCliente(registro, id_cliente);
  const [venta] = sku ? pdaVenta(cliente, sku) : [null];
  return { registro, cliente, venta };
}

//////////////////// Siguiente id disponible ////////////////////
/*
El programa asigna el id, no se le envia. Pero el id forma parte de las seeds del cliente, y una
transaccion de Solana declara por adelantado TODAS las cuentas que va a tocar: el runtime no puede
descubrir una cuenta a mitad de ejecucion. Por eso el cliente igual tiene que leer el contador,
no para mandarlo, sino para calcular la direccion que va en la transaccion.
*/
async function siguienteId(nombre_negocio) {
  const [pda_registro] = pdaRegistro(nombre_negocio);
  const registroAccount = await pg.program.account.registro.fetch(pda_registro);
  return registroAccount.idCounter + 1; // En el IDL id_counter pasa a idCounter
}

//////////////////// Crear Registro ////////////////////
async function crearRegistro(nombre_negocio) {
  const [pda_registro] = pdaRegistro(nombre_negocio);

  const txHash = await pg.program.methods
    .crearRegistro(nombre_negocio) // crear_registro -> en el IDL pasa a camelCase
    .accounts({
      owner: owner,
      registro: pda_registro,
    })
    .rpc();

  console.log("txHash: ", txHash);
}

//////////////////// Crear Cliente ////////////////////
// Instruccion aparte porque "init" no puede ser condicional. Devuelve el id asignado para
// poder encadenarlo con registrarVenta.
async function crearCliente(nombre_negocio, nombre) {
  const id_cliente = await siguienteId(nombre_negocio); // Solo para derivar la direccion
  const { registro, cliente } = cadena(nombre_negocio, id_cliente, "");

  const txHash = await pg.program.methods
    .crearCliente(nombre) // crear_cliente: el nombre si es un dato, el id no
    .accounts({
      owner: owner,
      registro: registro,
      cliente: cliente,
    })
    .rpc();

  console.log("txHash: ", txHash);
  console.log(`Cliente ${nombre} creado con id:`, id_cliente);

  return id_cliente;
}

//////////////////// Registrar Venta ////////////////////
// id_cliente y sku viajan dos veces: como argumentos de la instruccion y como semillas de las
// cuentas. No es redundancia, es lo que permite al programa validar que las cuentas enviadas
// son las que dicen ser. monto es u32 y id_cliente u16: Anchor acepta numeros de JS hasta
// 32 bits; a partir de u64 hay que usar new BN(valor).
async function registrarVenta(
  nombre_negocio,
  id_cliente,
  sku,
  descripcion,
  monto
) {
  const { registro, cliente, venta } = cadena(nombre_negocio, id_cliente, sku);

  const txHash = await pg.program.methods
    .registrarVenta(id_cliente, sku, descripcion, monto) // registrar_venta
    .accounts({
      owner: owner,
      registro: registro,
      cliente: cliente,
      venta: venta,
    })
    .rpc();

  console.log("txHash: ", txHash);
}

//////////////////// Hacer Devolucion ////////////////////
// La cuenta se cierra sola gracias a 'close = owner' y el rent vuelve al owner.
async function hacerDevolucion(nombre_negocio, id_cliente, sku) {
  const { registro, cliente, venta } = cadena(nombre_negocio, id_cliente, sku);

  const txHash = await pg.program.methods
    .hacerDevolucion(id_cliente, sku) // hacer_devolucion
    .accounts({
      owner: owner,
      registro: registro,
      cliente: cliente,
      venta: venta,
    })
    .rpc();

  console.log("txHash: ", txHash);
}

//////////////////// Cambiar Monto ////////////////////
// El registro y el cliente van aunque no se modifiquen: el programa los necesita para derivar
// y validar la cuenta de la venta.
async function cambiarMonto(nombre_negocio, id_cliente, sku, nuevo_monto) {
  const { registro, cliente, venta } = cadena(nombre_negocio, id_cliente, sku);

  const txHash = await pg.program.methods
    .cambiarMonto(id_cliente, sku, nuevo_monto) // cambiar_monto
    .accounts({
      owner: owner,
      registro: registro,
      cliente: cliente,
      venta: venta,
    })
    .rpc();

  console.log("txHash: ", txHash);
}

//////////////////// Ver Clientes ////////////////////
/*
Cada cliente y cada venta son cuentas independientes: el registro no guarda sus datos, guarda sus
DIRECCIONES. Por eso hay que ir a buscar cada una desde el cliente, lo que es mas eficiente que
recorrer multiples cuentas desde el programa.

1. Determinar el PDA del registro
2. Obtener el vector de clientes (direcciones)
3. Por cada direccion, obtener la informacion del cliente
4. De cada cliente, obtener su vector de ventas (mas direcciones)
5. Por cada direccion de venta, obtener su informacion
*/
async function verClientes(nombre_negocio) {
  const [pda_registro] = pdaRegistro(nombre_negocio);

  try {
    const registroAccount = await pg.program.account.registro.fetch(
      pda_registro
    );

    console.log("Negocio:", registroAccount.nombreNegocio);
    console.log("Ultimo id asignado:", registroAccount.idCounter);

    const numero_clientes = registroAccount.clientes.length;

    if (numero_clientes === 0) {
      console.log("Registro vacío, aún no hay clientes");
      return;
    }

    console.log("Cantidad de clientes:", numero_clientes);

    for (let i = 0; i < numero_clientes; i++) {
      const clienteKey = registroAccount.clientes[i];
      const clienteAccount = await pg.program.account.cliente.fetch(clienteKey);

      console.log(
        `\nCliente #${i + 1}: ${clienteAccount.nombre} \n * Id: ${
          clienteAccount.idCliente
        } \n * Compras: ${
          clienteAccount.compras
        } \n * Dirección(PDA): ${clienteKey.toBase58()}`
      );

      for (let j = 0; j < clienteAccount.historial.length; j++) {
        const ventaKey = clienteAccount.historial[j];
        const ventaAccount = await pg.program.account.venta.fetch(ventaKey);

        console.log(
          `   Venta #${j + 1}: SKU ${ventaAccount.sku} | ${
            ventaAccount.descripcion
          } | $${ventaAccount.monto} | PDA: ${ventaKey.toBase58()}`
        );
      }
    }
  } catch (error) {
    console.error("Error viendo clientes:", error);

    if (error.message) console.error("Mensaje de error:", error.message);
    if (error.logs) console.error("Logs del programa:", error.logs);
  }
}

//////////////////// Alta de un cliente nuevo ////////////////////
// Son dos transacciones: crear la cuenta del cliente y luego la de su primera venta.
// Para un cliente que ya existe basta con llamar registrarVenta().
async function clienteNuevoConVenta(
  nombre_negocio,
  nombre,
  sku,
  descripcion,
  monto
) {
  const id_cliente = await crearCliente(nombre_negocio, nombre); // Transaccion 1
  await registrarVenta(nombre_negocio, id_cliente, sku, descripcion, monto); // Transaccion 2

  console.log("Alta completa para el cliente con id:", id_cliente);
}

crearRegistro(nombre_negocio);
//////////////////// Eliminar Cliente (Dia 5 + Mejora) ////////////////////
// Cierra la cuenta PDA del cliente (close = owner) y devuelve el rent al owner.
// Falla si el cliente aun tiene compras activas (compras > 0).
async function eliminarCliente(nombre_negocio, id_cliente) {
  const { registro, cliente } = cadena(nombre_negocio, id_cliente, "");

  const txHash = await pg.program.methods
    .eliminarCliente(id_cliente) // eliminar_cliente
    .accounts({
      owner: owner,
      registro: registro,
      cliente: cliente,
    })
    .rpc();

  console.log("Cliente eliminado. txHash:", txHash);
}

//////////////////// Flujo Completo de Demostracion ////////////////////
async function ejecutarFlujoCompleto() {
  const negocioDemo = "Tienda_" + Math.floor(Math.random() * 10000);
  console.log("=== 1. Creando registro:", negocioDemo);
  await crearRegistro(negocioDemo);

  console.log("\n=== 2. Dando de alta cliente y venta valida");
  const idCliente = await crearCliente(negocioDemo, "Isaac K");
  await registrarVenta(negocioDemo, idCliente, "Sabri", "Sabritas 45g", 30);

  console.log("\n=== 3. Probando validacion: venta con monto 0 (debe rechazarse)");
  try {
    await registrarVenta(negocioDemo, idCliente, "Grati", "Producto en cero", 0);
  } catch (err) {
    console.log("Rechazo esperado on-chain:", err.error?.errorMessage || err.message);
  }

  console.log("\n=== 4. Actualizando monto y consultando estado");
  await cambiarMonto(negocioDemo, idCliente, "Sabri", 35);
  await verClientes(negocioDemo);

  console.log("\n=== 5. Probando validacion: baja de cliente con compras activas (debe rechazarse)");
  try {
    await eliminarCliente(negocioDemo, idCliente);
  } catch (err) {
    console.log("Rechazo esperado on-chain:", err.error?.errorMessage || err.message);
  }

  console.log("\n=== 6. Procesando devolucion y dando de baja al cliente (Dia 5)");
  await hacerDevolucion(negocioDemo, idCliente, "Sabri");
  await eliminarCliente(negocioDemo, idCliente);
  await verClientes(negocioDemo);
}

ejecutarFlujoCompleto();
