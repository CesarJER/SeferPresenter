# Avisos de Terceros y Licencias de Dependencias (Third-Party Notices)

Este documento detalla las atribuciones, licencias y avisos legales correspondientes a los componentes, librerías, activos multimedia y herramientas de terceros utilizados o distribuidos en relación con **SeferPresenter**.

---

## 1. Activos multimedia y efectos de sonido

### 1.1. Efectos de sonido (Pixabay)
Los siguientes archivos ubicados en `static/audio/sounds/` proceden de [Pixabay](https://pixabay.com/) y se incorporan como parte funcional de la aplicación:

- `Pregunta.mp3`
- `aplausos.mp3`
- `Mal.ogg`

**Licencia:** Pixabay Content License  
**Términos:** Permite el uso e integración del contenido en una obra, aplicación o producto mayor sin coste, pero prohíbe la venta o redistribución de los archivos de audio como contenido multimedia independiente o banco de sonido. Para más información, consulte:  
[https://pixabay.com/service/license-summary/](https://pixabay.com/service/license-summary/)

### 1.2. Archivos técnicos y de audio generados
- `bip.mp3`: Generado específicamente para el proyecto con fines de notificación de audio.
- `silence.ogg`: Archivo técnico de audio generado para desbloqueo de contexto de audio y mantenimiento de sesión de audio en navegadores móviles (iOS/Android).

**Licencia:** GPLv3, según [LICENSE](LICENSE).

### 1.3. Tipografías y fuentes
SeferPresenter **no distribuye archivos binarios de fuentes tipográficas**. Las referencias en hojas de estilo (`src/index.css`) a familias tipográficas hebreas (`Taamey D Web`, `Frank Ruehl CLM`, `David CLM`, `Times New Roman`, etc.) constituyen declaraciones de reserva (fallback) que dependen de las tipografías instaladas por el sistema operativo o cargadas por el usuario/operador en su propio entorno.

### 1.4. Datos y textos de ejemplo
Las presentaciones de ejemplo incluidas en `examples/SeferPrivateData/` son datos sintéticos y neutrales para pruebas de desarrollo local. El corpus de textos reales y los medios de producción son aportados soberanamente por cada operador y residen fuera del repositorio en `SEFER_DATA_DIR`.

---

## 2. Dependencias directas de producción (Runtime Dependencies)

Las siguientes librerías de software de código abierto son utilizadas directamente en el cliente web y en el servidor local de SeferPresenter:

| Paquete | Versión | Licencia | Autor / Proyecto | Repositorio |
| :--- | :--- | :--- | :--- | :--- |
| **DOMPurify** | `^3.4.12` | Apache-2.0 / MPL-2.0 | Cure53 | [github.com/cure53/DOMPurify](https://github.com/cure53/DOMPurify) |
| **framer-motion** | `^12.38.0` | MIT | Matt Perry / Motion Division | [github.com/motiondivision/motion](https://github.com/motiondivision/motion) |
| **livekit-client** | `^2.19.2` | Apache-2.0 | LiveKit | [github.com/livekit/client-sdk-js](https://github.com/livekit/client-sdk-js) |
| **livekit-server-sdk** | `^2.19.1` | Apache-2.0 | David Zhao / LiveKit | [github.com/livekit/node-sdks](https://github.com/livekit/node-sdks) |
| **lucide-react** | `^1.16.0` | ISC | Eric Fennis / Lucide Project | [github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **papaparse** | `^5.5.2` | MIT | Matthew Holt | [github.com/mholt/PapaParse](https://github.com/mholt/PapaParse) |
| **qrcode.react** | `^4.2.0` | ISC | Paul O’Shannessy | [github.com/zpao/qrcode.react](https://github.com/zpao/qrcode.react) |
| **react** | `^19.2.6` | MIT | Meta Platforms, Inc. | [github.com/facebook/react](https://github.com/facebook/react) |
| **react-dom** | `^19.2.6` | MIT | Meta Platforms, Inc. | [github.com/facebook/react](https://github.com/facebook/react) |
| **react-markdown** | `^10.1.0` | MIT | Espen Hovlandsdal | [github.com/remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) |
| **remark-gfm** | `^4.0.1` | MIT | Titus Wormer | [github.com/remarkjs/remark-gfm](https://github.com/remarkjs/remark-gfm) |
| **ws** | `^8.21.0` | MIT | Einar Otto Stangvik | [github.com/websockets/ws](https://github.com/websockets/ws) |

---

## 3. Herramientas de compilación y desarrollo destacadas

| Paquete | Versión | Licencia | Propósito |
| :--- | :--- | :--- | :--- |
| **ffmpeg-static** | `^5.3.0` | GPL-3.0-or-later | Binarios estáticos de FFmpeg utilizados por `scripts/make-pingpong.js` para generar bucles continuos de vídeo. Compatible con la licencia GPLv3 del proyecto. |
| **typescript** | `~6.0.2` | Apache-2.0 | Compilador y comprobación estática de tipos. |
| **vite** | `^8.0.12` | MIT | Servidor de desarrollo frontend y empaquetador de producción. |
| **vitest** | `^4.1.8` | MIT | Suite de pruebas unitarias y de integración. |
| **eslint** | `^10.3.0` | MIT | Análisis estático y verificación de calidad de código. |
| **tailwindcss** | `^3.4.19` | MIT | Framework de diseño y utilidades CSS. |
| **postcss** / **autoprefixer** | `^8.5.14` / `^10.5.0` | MIT | Transformación y compatibilidad de CSS. |
| **jsdom** | `^29.1.1` | MIT | Emulación de DOM para pruebas sin navegador. |
| **@testing-library/react** | `^16.2.0` | MIT | Utilidades para pruebas de componentes React. |

---

## 4. Textos de licencias aplicables de terceros

### Licencia MIT
```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Licencia Apache 2.0
```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### Licencia ISC
```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Mozilla Public License Version 2.0 (MPL-2.0)
```text
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at https://mozilla.org/MPL/2.0/.
```
