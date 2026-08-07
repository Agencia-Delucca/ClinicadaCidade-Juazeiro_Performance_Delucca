"""
Atalho: coleta os dados e gera o dashboard em um comando so.

Uso:
    python scripts/dashboard.py                       # ultimos 30 dias
    python scripts/dashboard.py --dias 7
    python scripts/dashboard.py --desde 2026-08-01 --ate 2026-08-04
"""

import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def rodar(script, args):
    print(f"\n>>> {script}")
    r = subprocess.run([sys.executable, str(AQUI / script), *args])
    if r.returncode != 0:
        sys.exit(f"Falhou em {script}.")


def main():
    args = sys.argv[1:]
    rodar("dashboard_coleta.py", args)
    rodar("dashboard_render.py", [])
    destino = AQUI.parent / "dashboard" / "index.html"
    print(f"\nPronto. Abra: {destino}")


if __name__ == "__main__":
    main()
