from typing import Literal

# Modulo aparte (sin depender de cases.py ni ai.py) para que ambos puedan
# importar CaseOutcome sin crear un import circular: cases.py importa de
# ai.py (AIAnalyzeResponse), asi que ai.py no puede importar de cases.py.
CaseOutcome = Literal[
    "con_hallazgos",
    "sin_hallazgos",
    "pendiente",
    "en_proceso",
    "derivado",
    "mas_antecedentes",
    "investigado_sin_compromiso",
    "falso_positivo",
    "mitigado",
    "sin_recepcion",
]
