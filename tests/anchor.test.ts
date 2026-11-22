describe("Registro de Ventas con PDAs - Pruebas y Validaciones", () => {
  const owner = pg.wallet.publicKey;
  const nombreNegocio = "Tienda_" + Math.floor(Math.random() * 10000);
  const idCliente = 1;
  const skuProducto = "SKU01";

  const [registroPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("registro"), Buffer.from(nombreNegocio), owner.toBuffer()],
    pg.program.programId
  );

  const idClienteBuffer = new BN(idCliente).toArrayLike(Buffer, "le", 2);
  const [clientePda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("cliente"), registroPda.toBuffer(), idClienteBuffer],
    pg.program.programId
  );

  const [ventaPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("venta"), clientePda.toBuffer(), Buffer.from(skuProducto)],
    pg.program.programId
  );

  async function confirmarTx(tx: string) {
    const latestBlockhash = await pg.connection.getLatestBlockhash();
    await pg.connection.confirmTransaction(
      {
        signature: tx,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      },
      "confirmed"
    );
  }

  it("1. Crea el registro del negocio", async () => {
    const tx = await pg.program.methods
      .crearRegistro(nombreNegocio)
      .accounts({
        owner,
        registro: registroPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await confirmarTx(tx);
    console.log("TX Crear Registro:", "https://solana.com" + tx + "?cluster=devnet");

    const cuentaRegistro = await pg.program.account.registro.fetch(registroPda);
    assert.equal(cuentaRegistro.nombreNegocio, nombreNegocio);
    assert.equal(cuentaRegistro.idCounter, 0);
  });

  it("2. Da de alta un cliente", async () => {
    const tx = await pg.program.methods
      .crearCliente("Carlos Perez")
      .accounts({
        owner,
        registro: registroPda,
        cliente: clientePda,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await confirmarTx(tx);
    console.log("TX Crear Cliente:", "https://solana.com" + tx + "?cluster=devnet");

    const cuentaCliente = await pg.program.account.cliente.fetch(clientePda);
    assert.equal(cuentaCliente.nombre, "Carlos Perez");
    assert.equal(cuentaCliente.idCliente, 1);
  });

  it("3. RECHAZA registrar una venta con monto 0 (Validacion de negocio)", async () => {
    const [ventaCeroPda] = web3.PublicKey.findProgramAddressSync(
      [Buffer.from("venta"), clientePda.toBuffer(), Buffer.from("SKU00")],
      pg.program.programId
    );

    try {
      await pg.program.methods
        .registrarVenta(idCliente, "SKU00", "Producto Gratis", 0)
        .accounts({
          owner,
          registro: registroPda,
          cliente: clientePda,
          venta: ventaCeroPda,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();
      assert.fail("Debio fallar porque el monto es 0");
    } catch (err) {
      console.log("Rechazo esperado (MontoInvalido):", err.error?.errorMessage || err.message);
      assert.ok(err.toString().includes("MontoInvalido"));
    }
  });

  it("4. Registra una venta valida y modifica su monto", async () => {
    const txVenta = await pg.program.methods
      .registrarVenta(idCliente, skuProducto, "Teclado Mecanico", 1500)
      .accounts({
        owner,
        registro: registroPda,
        cliente: clientePda,
        venta: ventaPda,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    await confirmarTx(txVenta);
    console.log("TX Registrar Venta:", "https://solana.com" + txVenta + "?cluster=devnet");

    const txCambio = await pg.program.methods
      .cambiarMonto(idCliente, skuProducto, 1800)
      .accounts({
        owner,
        registro: registroPda,
        cliente: clientePda,
        venta: ventaPda,
      })
      .rpc();

    await confirmarTx(txCambio);
    console.log("TX Cambiar Monto:", "https://solana.com" + txCambio + "?cluster=devnet");

    const cuentaVenta = await pg.program.account.venta.fetch(ventaPda);
    assert.equal(cuentaVenta.monto, 1800);
  });

  it("5. RECHAZA eliminar cliente mientras tenga compras activas (Validacion de integridad)", async () => {
    try {
      await pg.program.methods
        .eliminarCliente(idCliente)
        .accounts({
          owner,
          registro: registroPda,
          cliente: clientePda,
        })
        .rpc();
      assert.fail("Debio fallar porque el cliente tiene compras activas");
    } catch (err) {
      console.log("Rechazo esperado (ClienteConComprasActivas):", err.error?.errorMessage || err.message);
      assert.ok(err.toString().includes("ClienteConComprasActivas"));
    }
  });

  it("6. Procesa devolucion y da de baja al cliente exitosamente (Dia 5)", async () => {
    const txDevolucion = await pg.program.methods
      .hacerDevolucion(idCliente, skuProducto)
      .accounts({
        owner,
        registro: registroPda,
        cliente: clientePda,
        venta: ventaPda,
      })
      .rpc();

    await confirmarTx(txDevolucion);
    console.log("TX Devolucion:", "https://solana.com" + txDevolucion + "?cluster=devnet");

    const txBaja = await pg.program.methods
      .eliminarCliente(idCliente)
      .accounts({
        owner,
        registro: registroPda,
        cliente: clientePda,
      })
      .rpc();

    await confirmarTx(txBaja);
    console.log("TX Baja Cliente:", "https://solana.com" + txBaja + "?cluster=devnet");

    const cuentaRegistro = await pg.program.account.registro.fetch(registroPda);
    assert.equal(cuentaRegistro.clientes.length, 0);
  });
});
