# Plano para un repositorio jurídico privado

Estado: plantilla general; no crea ni configura ningún repositorio.

## 1. Contenido permitido

El repositorio puede custodiar políticas, avisos, RAT/ROPA, EIPD, matrices,
informes aprobados, plantillas, actas de revisión y manifiestos no nominativos.
No debe contener secretos, credenciales, copias de identidad, voz, vídeo, alias,
mensajes, direcciones IP ni expedientes reales de derechos o incidentes con
datos personales. Estos últimos requieren un expediente cifrado y separado; Git
no facilita la supresión completa de información ya incluida en su historial.

## 2. Estructura propuesta

```text
legal-privacy/
├── README.md
├── CODEOWNERS
├── policies/
├── notices/
├── accountability/
├── audits/
├── manifests/
├── templates/
└── releases/
```

Los documentos específicos del operador pueden perder el sufijo `.local` solo
después de migrarlos al repositorio privado y comprobar que el repositorio de
producto sigue ignorando su copia de trabajo.

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
