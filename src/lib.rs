use anchor_lang::prelude::*;

declare_id!("7YXdjfWvzE6e75c8ZjpZd72tWrkoguVHnDqgxVUzoExw");

#[program]
pub mod registro {
    use super::*;

    /////////////////////////// Crear Registro ///////////////////////////
    pub fn crear_registro(context: Context<NuevoRegistro>, nombre_negocio: String) -> Result<()> {
        context.accounts.registro.set_inner(Registro {
            owner: context.accounts.owner.key(),
            nombre_negocio: nombre_negocio.clone(),
            clientes: Vec::new(),
            id_counter: 0,
        });

        msg!("Registro: {} creado exitosamente!", nombre_negocio);
        Ok(())
    }

    /////////////////////////// Nuevo Cliente ///////////////////////////
    pub fn crear_cliente(context: Context<NuevoCliente>, nombre: String) -> Result<()> {
        let cliente_key = context.accounts.cliente.key();
        let registro = &mut context.accounts.registro;

        let id_cliente = registro.id_counter + 1;
        registro.id_counter = id_cliente;
        registro.clientes.push(cliente_key);

        context.accounts.cliente.set_inner(Cliente {
            id_cliente,
            nombre: nombre.clone(),
            compras: 0,
            historial: Vec::new(),
        });

        msg!("Cliente {} creado con id: {}", nombre, id_cliente);
        Ok(())
    }

    /////////////////////////// Registrar Venta ///////////////////////////
    pub fn registrar_venta(
        context: Context<NuevaVenta>,
        _id_cliente: u16,
        sku: String,
        descripcion: String,
        monto: u32,
    ) -> Result<()> {
        // MEJORA FUNCIONAL 1: Validacion de negocio para evitar ventas en 0
        require!(monto > 0, Errores::MontoInvalido);

        context.accounts.venta.set_inner(Venta {
            sku,
            descripcion,
            monto,
        });

        let venta_key = context.accounts.venta.key();
        let cliente = &mut context.accounts.cliente;

        cliente.historial.push(venta_key);
        cliente.compras += 1;

        msg!(
            "Venta registrada para el cliente con id: {}",
            cliente.id_cliente
        );
        Ok(())
    }

    /////////////////////////// Hacer Devolucion ///////////////////////////
    pub fn hacer_devolucion(
        context: Context<EliminarVenta>,
        _id_cliente: u16,
        sku: String,
    ) -> Result<()> {
        let venta_key = context.accounts.venta.key();
        let cliente = &mut context.accounts.cliente;

        require!(cliente.historial.contains(&venta_key), Errores::NoSKU);

        cliente.historial.retain(|&k| k != venta_key);
        cliente.compras -= 1;

        msg!(
            "Venta con sku: {}, devuelta por el cliente con id: {}",
            sku,
            cliente.id_cliente
        );
        Ok(())
    }

    /////////////////////////// Cambiar Monto ///////////////////////////
    pub fn cambiar_monto(
        context: Context<ModificarVenta>,
        _id_cliente: u16,
        sku: String,
        nuevo_monto: u32,
    ) -> Result<()> {
        // MEJORA FUNCIONAL 1: Validacion de negocio al actualizar monto
        require!(nuevo_monto > 0, Errores::MontoInvalido);

        let venta = &mut context.accounts.venta;
        let viejo_monto = venta.monto;
        venta.monto = nuevo_monto;

        msg!(
            "El monto de la venta con sku: {}, paso de: {}, a: {}",
            sku,
            viejo_monto,
            nuevo_monto
        );
        Ok(())
    }

    /////////////////////////// Eliminar Cliente ///////////////////////////
    pub fn eliminar_cliente(
        context: Context<EliminarCliente>,
        _id_cliente: u16,
    ) -> Result<()> {
        let cliente_key = context.accounts.cliente.key();
        let cliente = &context.accounts.cliente;
        let registro = &mut context.accounts.registro;

        // MEJORA FUNCIONAL 2: Regla de integridad referencial antes de cerrar cuenta
        require!(cliente.compras == 0, Errores::ClienteConComprasActivas);
        require!(registro.clientes.contains(&cliente_key), Errores::NoCliente);

        registro.clientes.retain(|&k| k != cliente_key);

        msg!(
            "Cliente con id: {} eliminado y rent devuelto al owner",
            cliente.id_cliente
        );
        Ok(())
    }
}

/////////////////////////// Codigos de Error ///////////////////////////
#[error_code]
pub enum Errores {
    #[msg("Error, no eres el owner del registro")]
    NoOwner,
    #[msg("Error, la venta no esta en el historial del cliente")]
    NoSKU,
    #[msg("Error, el monto de la venta debe ser mayor a cero")]
    MontoInvalido,
    #[msg("Error, no se puede eliminar un cliente con compras activas")]
    ClienteConComprasActivas,
    #[msg("Error, el cliente no pertenece a este registro")]
    NoCliente,
}

/////////////////////////// CUENTAS ///////////////////////////
#[account]
#[derive(InitSpace)]
pub struct Registro {
    pub owner: Pubkey,
    #[max_len(30)]
    pub nombre_negocio: String,
    #[max_len(10)]
    pub clientes: Vec<Pubkey>,
    pub id_counter: u16,
}

#[account]
#[derive(InitSpace, PartialEq)]
pub struct Cliente {
    pub id_cliente: u16,
    #[max_len(30)]
    pub nombre: String,
    pub compras: u16,
    #[max_len(10)]
    pub historial: Vec<Pubkey>,
}

#[account]
#[derive(InitSpace, PartialEq)]
pub struct Venta {
    #[max_len(5)]
    pub sku: String,
    #[max_len(50)]
    pub descripcion: String,
    pub monto: u32,
}

/////////////////////////// CONTEXTOS ///////////////////////////
#[derive(Accounts)]
#[instruction(nombre_negocio: String)]
pub struct NuevoRegistro<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = Registro::INIT_SPACE + 8,
        seeds = [b"registro", nombre_negocio.as_bytes(), owner.key().as_ref()],
        bump
    )]
    pub registro: Account<'info, Registro>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct NuevoCliente<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ Errores::NoOwner)]
    pub registro: Account<'info, Registro>,

    #[account(
        init,
        payer = owner,
        space = Cliente::INIT_SPACE + 8,
        seeds = [b"cliente", registro.key().as_ref(), (registro.id_counter + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id_cliente: u16, sku: String)]
pub struct NuevaVenta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(has_one = owner @ Errores::NoOwner)]
    pub registro: Account<'info, Registro>,

    #[account(
        mut,
        seeds = [b"cliente", registro.key().as_ref(), id_cliente.to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        init,
        payer = owner,
        space = Venta::INIT_SPACE + 8,
        seeds = [b"venta", cliente.key().as_ref(), sku.as_bytes()],
        bump
    )]
    pub venta: Account<'info, Venta>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id_cliente: u16, sku: String)]
pub struct ModificarVenta<'info> {
    pub owner: Signer<'info>,

    #[account(has_one = owner @ Errores::NoOwner)]
    pub registro: Account<'info, Registro>,

    #[account(
        seeds = [b"cliente", registro.key().as_ref(), id_cliente.to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        mut,
        seeds = [b"venta", cliente.key().as_ref(), sku.as_bytes()],
        bump
    )]
    pub venta: Account<'info, Venta>,
}

#[derive(Accounts)]
#[instruction(id_cliente: u16, sku: String)]
pub struct EliminarVenta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(has_one = owner @ Errores::NoOwner)]
    pub registro: Account<'info, Registro>,

    #[account(
        mut,
        seeds = [b"cliente", registro.key().as_ref(), id_cliente.to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,

    #[account(
        mut,
        close = owner,
        seeds = [b"venta", cliente.key().as_ref(), sku.as_bytes()],
        bump
    )]
    pub venta: Account<'info, Venta>,
}

#[derive(Accounts)]
#[instruction(id_cliente: u16)]
pub struct EliminarCliente<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(mut, has_one = owner @ Errores::NoOwner)]
    pub registro: Account<'info, Registro>,

    #[account(
        mut,
        close = owner,
        seeds = [b"cliente", registro.key().as_ref(), id_cliente.to_le_bytes().as_ref()],
        bump
    )]
    pub cliente: Account<'info, Cliente>,
}
