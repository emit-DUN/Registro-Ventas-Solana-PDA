# Registro de Ventas con PDAs en Solana (Anchor)

Proyecto final del **Advanced Bootcamp - Solana Engineering Track (WayLearn)**.

## Base de partida
Este proyecto parte del repositorio base [`WayLearnLatam/Registro-Ventas-Solana-PDA`](https://github.com), el cual implementa la jerarquía de cuentas PDA (`Registro` -> `Cliente` -> `Venta`) y las operaciones CRUD básicas de registro, alta de cliente, registro de venta, modificación de monto y devolución.

---

## Aporte Funcional e Implementación Realizada

Además de completar la **baja de cliente (`eliminar_cliente`)** correspondiente al cierre de la Sesión 5 (cerrando la cuenta PDA del cliente con `close = owner` para recuperar el *rent* y limpiando su referencia en el vector `registro.clientes`), se añadieron **dos reglas de validación de negocio en Rust** con errores personalizados (`#[error_code]`):

1. **Validación de monto mayor a cero (`Errores::MontoInvalido`):**
   * Implementada en `registrar_venta` y `cambiar_monto` mediante `require!(monto > 0, Errores::MontoInvalido)`.
   * Evita el registro o actualización de ventas con valor `0`, protegiendo la integridad contable del negocio.
2. **Protección de integridad referencial en baja de cliente (`Errores::ClienteConComprasActivas`):**
   * Implementada en `eliminar_cliente` mediante `require!(cliente.compras == 0, Errores::ClienteConComprasActivas)`.
   * Impide dar de baja o cerrar la cuenta PDA de un cliente si todavía tiene ventas activas asociadas, evitando dejar cuentas `Venta` huérfanas en la blockchain hasta que se procesen sus devoluciones.

---

## Despliegue en Solana Devnet

* **Red:** Solana Devnet
* **Program ID:** `7YXdjfWvzeE6e75c8ZjpZd72tWrkoguVHnDgqxVUzoExw`
* **Ver en Solana Explorer:** https://solana.com/7YXdjfWvzE6e75c8ZjpZd72tWrkoguVHnDqgxVUzoExw

---

## Pruebas Automatizadas y Evidencias en Devnet

Se implementó una suite de **6 pruebas de integración** en `tests/anchor.test.ts` ejecutadas directamente contra Solana Devnet (`6 passing`):

| # | Caso de Prueba | Resultado | Evidencia (Transacción en Devnet) |
|---|---|---|---|
| 1 | `crear_registro`: Creación de cuenta PDA del negocio | ✅ Exitoso | `3ZzctiERSX9Hx68f1WjNn1fmYAFnzEKynDAEszKLawDk6bT4C3aiUhYryJX1zp29jdfeCTLjWJqTQGqGFtdNUwCg` |
| 2 | `crear_cliente`: Alta de cliente con ID autoincremental | ✅ Exitoso | `4J1hSDK22AMsxCiTSHsFogBmgLuCUPVvA577ZKLQZhXRKrPh4tLyivect6XP2BcA6Mu8wpTwvKtNDMWahAE5AX4T` |
| 3 | `registrar_venta` (monto `0`): Rechazo por regla de negocio (`MontoInvalido`) | ✅ Rechazado correctamente | Validado on-chain (`Error, el monto de la venta debe ser mayor a cero`) |
| 4 | `registrar_venta` + `cambiar_monto`: Registro válido y actualización | ✅ Exitoso | Venta: `vMXZVXugHQZgTEBgfEAGdvNqzMxWHtMDnVNr2SzqAfSMEvBmLC7VKDxiucaxwexZPTtwLStsUxnQE1FW9Pv6iXb` <br> Cambio: `4iwZpqvTdc44G9UnGZnzCeqUpqGkNJJiZ743HpqsMfZLYFKNh3SqpJwdb6Le5FdtWvGgWS48qwFsM6RsaBzG1sid` |
| 5 | `eliminar_cliente` con compras activas: Rechazo por integridad (`ClienteConComprasActivas`) | ✅ Rechazado correctamente | Validado on-chain (`Error, no se puede eliminar un cliente con compras activas`) |
| 6 | `hacer_devolucion` + `eliminar_cliente`: Devolución y baja definitiva con cierre de cuenta PDA | ✅ Exitoso | Devolución: `5yHpgPRQPB14th69w9xodtaw9HebRSfeQ8D3CYBepmefvGYEZsBhZ5UC9fx8mjdwfDCPbQwEsPsMY5AGz4h9TrQR` <br> Baja: `21a3THSgkK79FZ6WuMWfjDHrLHKrhd7GcszmMchoToPYKwdETcZBpq2xuY5FKaxvyRBVVYRrviM5jcktbtWkEUMc` |

---

## Cómo reproducir las pruebas

1. Importar este repositorio en [Solana Playground](https://solpg.io).
2. Conectarse a **Devnet** con una wallet con fondos de prueba.
3. Ejecutar **Build** para compilar el programa Anchor (`src/lib.rs`).
4. Ejecutar **Deploy** para desplegar en Devnet.
5. Ejecutar **Test** para correr `tests/anchor.test.ts` y verificar las 6 pruebas.
