"""Crea el primer usuario admin de MailingAI. Paso obligatorio antes del
primer login: sin esto, identity.users esta vacia y ningun login via SSO
Microsoft encuentra una fila con la que vincularse (ver
app/auth/dependencies.py / find_or_link_by_oauth), asi que nadie puede entrar.

Nunca escala privilegios de un usuario ya existente -- si el email ya esta
en identity.users, no toca esa fila.

Uso (dentro del contenedor del backend):
    docker exec mailingai_backend python -m app.scripts.bootstrap_admin --email admin@empresa.com --name "Nombre Apellido"
"""

import argparse
import asyncio

import asyncpg

from app.config import get_settings


async def bootstrap_admin(email_address: str, display_name: str | None) -> None:
    settings = get_settings()
    conn = await asyncpg.connect(
        host=settings.db_host,
        port=settings.db_port,
        database=settings.db_name,
        user=settings.db_user,
        password=settings.db_password,
    )
    try:
        existing = await conn.fetchrow(
            "SELECT user_id, role FROM identity.users WHERE lower(email_address) = lower($1);",
            email_address,
        )
        if existing is not None:
            print(
                f"Ya existe un usuario con ese email (user_id={existing['user_id']}, "
                f"role={existing['role']}); no se modifica."
            )
            return
        row = await conn.fetchrow(
            """
            INSERT INTO identity.users (email_address, display_name, role)
            VALUES ($1, $2, 'admin')
            RETURNING user_id;
            """,
            email_address,
            display_name,
        )
        print(
            f"Admin creado: user_id={row['user_id']}, email={email_address}. "
            "Inicia sesion con SSO Microsoft usando ese mismo email para activar la cuenta."
        )
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crea el primer usuario admin de MailingAI (paso obligatorio antes del primer login)."
    )
    parser.add_argument(
        "--email", required=True, help="Email corporativo, debe coincidir con la cuenta Microsoft con la que se va a loguear"
    )
    parser.add_argument("--name", default=None, help="Nombre para mostrar (opcional)")
    args = parser.parse_args()
    asyncio.run(bootstrap_admin(args.email, args.name))


if __name__ == "__main__":
    main()
