"""
Taxonomia de especialidades e exames, e classificacao dos nomes de campanha,
conjunto e grupo de anuncios.

Os nomes nas contas nao seguem padrao (ha abreviacoes, variacoes e erros de
digitacao). Este modulo concentra o de-para para que o resto do dashboard nao
precise adivinhar.
"""

import re
import unicodedata

# As 39 especialidades do catalogo do site, com os apelidos que aparecem
# de fato nos nomes de conjunto e grupo de anuncios.
ESPECIALIDADES = {
    "Acupuntura": ["acupuntura"],
    "Alergologia": ["alergo"],
    "Angiologia": ["angio"],
    "Cabeça e Pescoço": ["cabeca e pescoco", "cabeça e pescoço"],
    "Cardiologia": ["cardio", "cadio"],  # "Cadiologia" existe escrito errado
    "Cardiologia Pediátrica": ["cardio ped", "cardiologia pediatrica"],
    "Cirurgia Geral": ["cirurgia geral"],
    "Cirurgia Vascular": ["vascular", "cirurgia vascular"],
    "Clínico Geral": ["clinico geral", "clinica geral", "clinico-geral"],
    "Dermatologia": ["dermato", "derma"],
    "Endocrinologia": ["endocrino", "endocri"],
    "Fonoaudiologia": ["fono"],
    "Gastroenterologia": ["gastro"],
    "Gastroenterologia Pediátrica": ["gastro ped"],
    "Geriatria": ["geriatr"],
    "Ginecologia e Obstetrícia": ["gineco", "obstetr"],
    "Hematologia e Hemoterapia": ["hemato"],
    "Hepatologia": ["hepato"],
    "Homeopatia": ["homeopat"],
    "Infectologia": ["infecto"],
    "Mastologia": ["masto"],
    "Medicina de Família e Comunidade": ["medicina de familia", "familia e comunidade"],
    "Nefrologia": ["nefro"],
    "Nefrologia Pediátrica": ["nefro ped"],
    "Neurologia": ["neuro"],
    "Neurologia Pediátrica": ["neuroped", "neuro ped"],
    "Nutrição": ["nutricao", "nutricionista"],
    "Nutrologia": ["nutrolog"],
    "Oftalmologia": ["oftalmo", "oftamo"],
    "Oncologia": ["onco"],
    "Ortopedia": ["ortoped"],
    "Otorrinolaringologia": ["otorrino", "otorino"],
    "Pediatria": ["pediatr"],
    "Pneumologia": ["pneumo", "pneumonolog"],
    "Proctologia": ["procto"],
    "Psicologia": ["psicolog"],
    "Psiquiatria": ["psiquiatr"],
    "Reumatologia": ["reumato"],
    "Urologia": ["urolog"],
}

# Os 31 exames, agrupados pelas familias que aparecem nas campanhas.
EXAMES = {
    "Ultrassonografia": ["ultrassom", "ultrassonografia", "us geral", "us "],
    "Exames Laboratoriais": ["laboratorial", "laboratorio", "laboratoriais"],
    "Exames Cardiológicos": ["exames cardio", "exame cardio"],
    "Exames Oftalmológicos": ["exames oftalmo", "exame oftalmo"],
    "Exames Neurológicos": ["exames neuro"],
    "Exames Pneumológicos": ["exames pneumo"],
    "Exames de Nutrição": ["exames de nutricao"],
    "Exame Toxicológico": ["toxicolog"],
    "Colonoscopia": ["colonoscopia"],
    "Endoscopia": ["endoscopia"],
    "Espirometria": ["espirometria"],
    "Ecocardiograma": ["ecocardiograma", "eco "],
    "Mamografia": ["mamografia"],
    "Raio-X": ["raio-x", "raio x", "rx "],
    "Ressonância Magnética": ["ressonancia"],
    "Tomografia Computadorizada": ["tomografia"],
    "Teste de DNA": ["teste de dna", "dna"],
}

# Baldes tematicos do briefing.
BALDES = [
    ("Top Especialidades", [r"top\s*especialidade", r"wp-?\s*prioridade"]),
    ("Demais Especialidades", [r"demais\s*especialidade"]),
    ("Ultrassom", [r"ultrassom", r"ultrassonografia", r"\bus\b"]),
    ("Exames", [r"\bexame", r"laboratorial", r"laboratorio", r"toxicolog"]),
    ("Clínica Popular", [r"popular", r"generico", r"gen[eé]rico"]),
    ("Branding", [r"brand", r"reconhecimento", r"institucional"]),
    (
        "Alcance / Engajamento",
        [r"impulsionamento", r"\balc\b", r"\[alc\]", r"alcance", r"engajamento", r"tr[aá]fego"],
    ),
]


def normalizar(texto):
    """Minusculas, sem acento - para casar nomes escritos de formas diferentes."""
    if not texto:
        return ""
    t = unicodedata.normalize("NFD", str(texto))
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return t.lower().strip()


def _casa(texto_norm, apelidos):
    for a in apelidos:
        if normalizar(a) in texto_norm:
            return True
    return False


def detectar_especialidade(*textos):
    """Devolve a especialidade mais especifica encontrada nos textos dados."""
    alvo = " ".join(normalizar(t) for t in textos if t)
    achados = [nome for nome, ap in ESPECIALIDADES.items() if _casa(alvo, ap)]
    if not achados:
        return None
    # Prefere o nome mais longo: "Cardiologia Pediátrica" ganha de "Cardiologia".
    return max(achados, key=len)


def detectar_exame(*textos):
    alvo = " ".join(normalizar(t) for t in textos if t)
    achados = [nome for nome, ap in EXAMES.items() if _casa(alvo, ap)]
    if not achados:
        return None
    return max(achados, key=len)


def detectar_balde(*textos):
    alvo = " ".join(normalizar(t) for t in textos if t)
    for nome, padroes in BALDES:
        for p in padroes:
            if re.search(p, alvo):
                return nome
    return "Outras"


def eh_topo_de_funil(*textos):
    """Conjuntos de alcance/engajamento nao buscam contato - nao entram no CPL."""
    return detectar_balde(*textos) == "Alcance / Engajamento"
