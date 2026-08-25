# Plano para un repositorio jurídico privado

Estado: arquitectura implementada localmente; la protección del futuro remoto
privado sigue siendo una operación del propietario.

## 1. Contenido permitido

El repositorio puede custodiar políticas, avisos, RAT/ROPA, EIPD, matrices,
informes aprobados, plantillas, actas de revisión y manifiestos no nominativos.
No debe contener secretos, credenciales, copias de identidad, voz, vídeo, alias,
mensajes, direcciones IP ni expedientes reales de derechos o incidentes con
datos personales. Estos últimos requieren un expediente cifrado y separado; Git
no facilita la supresión completa de información ya incluida en su historial.

## 2. Estructura propuesta

```text
SeferPrivateData/legal/
├── README.md
├── current.json
└── releases/
    ├── 000001/
    │   ├── privacy-policy.md
    │   ├── privacy-summary.md
    │   └── manifest.json
    └── 000002/
```

Cada manifiesto contiene una secuencia monotónica, estado, versión, hashes de
documentos y el hash del manifiesto anterior. `current.json` activa una secuencia.
El estado máximo aceptado se conserva fuera del Git anidado para detectar un
checkout anterior. Esto detecta retroversiones accidentales; no impide que un
administrador con control total altere ambos almacenamientos.

## 3. Configuración mínima de GitHub

- repositorio privado dentro de una organización, no de una cuenta personal;
- MFA obligatorio en la organización y recuperación administrada;
- permisos base mínimos y acceso mediante equipos;
- dos propietarios de continuidad, evitando administradores innecesarios;
- ruleset activo sobre `~DEFAULT_BRANCH` que exija pull request, una aprobación,
  revisión de CODEOWNERS, aprobación del último push, resolución de
  conversaciones y descarte de aprobaciones obsoletas;
- impedir force-push y borrado de la rama, sin bypass ordinario;
- checks obligatorios para Markdown, enlaces, secretos y estructura;
- ruleset separado para tags de versión que impida modificación y borrado;
- commits verificados criptográficamente y política de signoff cuando proceda;
- copia de recuperación cifrada y prueba periódica de restauración.

La disponibilidad de rulesets y algunas condiciones depende del plan de GitHub;
debe verificarse antes de la creación.

## 4. Flujo documental

1. Abrir rama de cambio y asignar identificador de documento/versión.
2. Ejecutar checks automáticos sin publicar contenido sensible.
3. Solicitar revisión de CODEOWNERS y aprobación de una persona distinta.
4. Fusionar mediante el método definido, crear tag protegido y release.
5. Registrar fecha de vigencia, hash y versión desplegada.
6. Para una corrección urgente, usar PR acelerada con revisión posterior
   documentada; no reescribir historia.

## 5. Criterio de aceptación de PR-15

PR-15 solo podrá cerrarse cuando exista evidencia exportada de privacidad del
repositorio, MFA, miembros/roles, rulesets de rama y tags, checks obligatorios,
CODEOWNERS, rechazo de force-push/borrado y restauración de una copia. Preparar
este plano no equivale a crear o verificar el repositorio.

Referencias oficiales: documentación de GitHub sobre
[reglas disponibles en rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets),
[protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule) y
[exigencia de autenticación en dos pasos](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-two-factor-authentication-for-your-organization/requiring-two-factor-authentication-in-your-organization).
