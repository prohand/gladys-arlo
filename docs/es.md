# Integración Arlo

Añade sus cámaras, timbres de vídeo, bases y sirenas Arlo a Gladys: imágenes,
movimiento, batería, modos Arlo (armado, desarmado, personalizados), sirena,
escenas y widgets del panel.

> **Integración en la nube.** Arlo no tiene API local: todo pasa por la nube de
> Arlo, con su cuenta Arlo. Gladys necesita conexión a internet, y Arlo debe
> estar accesible.

## Lo que obtiene

| Dispositivo Arlo                | En Gladys                                                                   |
| ------------------------------- | --------------------------------------------------------------------------- |
| Cámara (Pro, Ultra, Essential…) | Imagen, cámara encendida/apagada (modo privado Arlo), movimiento, batería   |
| Timbre de vídeo                 | Igual que una cámara, más «Timbre»                                          |
| Timbre de audio                 | Timbre, batería                                                             |
| Base (hub)                      | Modo Arlo (lista de modos de la base), sirena en las bases Pro              |
| Cámara Wi-Fi sin base           | Funciones de cámara, más su propio modo Arlo y su sirena (Pro 3 y superior) |
| Sirena Arlo                     | Sirena encendida/apagada                                                    |

(Todavía) no compatible: vídeo en directo, luces y carillones Arlo.

## Instalación

1. **Consejo:** cree una segunda cuenta Arlo para Gladys y compártale sus
   dispositivos desde la app Arlo (Ajustes → Conceder acceso). Arlo solo permite
   una sesión web por cuenta: usar su cuenta principal en Gladys puede cerrar su
   sesión en my.arlo.com, y al revés.
2. En Gladys, abra la configuración de la integración y rellene:
   - **Correo de Arlo** y **Contraseña de Arlo**;
   - **Código de verificación enviado por**: correo o SMS (el método debe estar
     activo en la cuenta Arlo).
3. Guarde y pulse **Enviarme un código**. Arlo envía un código por correo o SMS.
4. Escriba el código en **Validar el código** (antes de 10 minutos).
5. El estado se pone en verde. Abra la pestaña **Descubrimiento** y añada sus
   dispositivos.

La sesión se guarda en la integración (`/data`) y se reutiliza en cada
reinicio. Cuando Arlo la termina (normalmente tras unas semanas), el estado pide
un nuevo código: pulse de nuevo **Enviarme un código**.

### Opciones

| Opción                     | Por defecto | Qué hace                                                                                                      |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| Intervalo de actualización | 60 s        | Frecuencia de lectura de modos, baterías, imágenes y grabaciones. Un minuto mínimo.                           |
| Imagen nueva bajo demanda  | no          | Cuando Gladys pide una imagen, la cámara toma una nueva. Despierta las cámaras con batería: gasta su batería. |
| Registros detallados       | no          | Registra cada evento de Arlo. Útil para informar de un problema; desactívelo después.                         |

El botón **Probar la conexión** comprueba la sesión y vuelve a leer la lista de
dispositivos.

## Cómo funciona

- **Tiempo real:** el movimiento, el timbre, la batería, el modo privado y la
  sirena llegan por el flujo de eventos de Arlo.
- **En cada actualización:** la integración lee la lista de dispositivos (nueva
  imagen de cada cámara), los modos activos y las grabaciones de las últimas 24
  horas.
- **Imágenes:** Gladys acepta imágenes de cámara de hasta 150 KB. Las imágenes
  de Arlo más grandes las reduce la integración.
- Algunas cuentas Arlo no reciben el flujo en tiempo real. El movimiento, los
  cambios de modo y las detecciones inteligentes llegan igualmente, pero hasta
  una actualización más tarde.

## Escenas

### Disparadores

| Clave              | Cuándo                                                                                                         | Filtros                                               | Variables           |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
| `motion_detected`  | Una cámara ha visto algo moverse.                                                                              | Cámara                                                | –                   |
| `object_detected`  | La detección inteligente de Arlo ha reconocido lo que se movió (requiere Arlo Secure). Llega con la grabación. | Cámara, lo visto (persona, vehículo, animal, paquete) | `object`            |
| `doorbell_pressed` | Alguien ha pulsado un timbre.                                                                                  | Timbre                                                | –                   |
| `mode_changed`     | Una base ha cambiado de modo (app Arlo, horario, geovalla). No se dispara cuando lo cambió Gladys.             | Base, nuevo modo (armado, desarmado, personalizado)   | `mode`, `mode_name` |

Use las variables en las acciones siguientes, por ejemplo
`{{triggerEvent.data.object}}`.

### Acciones

| Clave           | Qué hace                                                                                            | Resultado              |
| --------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| `set_mode`      | Pasa una base a un modo: `armed`, `disarmed` o el nombre de un modo personalizado (p. ej. `Noche`). | `changed`, `mode_name` |
| `take_snapshot` | La cámara toma una nueva foto, que se muestra en Gladys. Siga con «Enviar imagen de la cámara».     | `taken`                |
| `sound_siren`   | Hace sonar una sirena durante un tiempo (5 a 300 s) y a un volumen (1 a 8).                         | `started`              |

Las acciones estándar de Gladys también funcionan con las funciones: encender o
apagar una cámara, elegir el «Modo Arlo», parar la sirena.

## Widgets del panel

- **Arlo: resumen** (`arlo_overview`): el modo de cada base, la batería de cada
  cámara, las últimas grabaciones con su miniatura y dos botones: **Armar
  todo** / **Desarmar todo**.
- **Cámara Arlo** (`arlo_camera`): elija una cámara. Muestra su última imagen,
  batería y movimiento en directo, su estado y su última grabación, con los
  botones **Tomar una foto** y **Encender / Apagar**.

## Solución de problemas

| Problema                              | Qué hacer                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| «Arlo pide un código de verificación» | Pulse **Enviarme un código** y luego **Validar el código**.                                                                                 |
| «No email verification method…»       | Elija el otro método (SMS) o añádalo en la app Arlo (Ajustes → Verificación en dos pasos).                                                  |
| «Invalid credentials»                 | Compruebe el correo y la contraseña. Inicie sesión una vez en my.arlo.com para asegurarse.                                                  |
| Rechazo con HTTP 403                  | La entrada de Arlo ha bloqueado la petición. Espere unos minutos y vuelva a intentarlo; si continúa, abra una incidencia con los registros. |
| Sin valor de batería                  | Espere a la siguiente actualización: Arlo la envía por el flujo de eventos.                                                                 |
| La detección no se dispara            | La detección inteligente (persona, vehículo…) requiere Arlo Secure; el movimiento solo no.                                                  |

Para informar de un problema, active **Registros detallados**, reprodúzcalo y
adjunte los registros de la integración (Gladys → Integraciones → Arlo →
Registros) a una incidencia de GitHub. Los registros nunca contienen su
contraseña ni su token.

## Privacidad

Su correo, su contraseña y su sesión Arlo se quedan en su Gladys. La
integración solo habla con servidores de Arlo (dominios `arlo.com`). Arlo no
publica una API oficial: esta integración usa las mismas llamadas que la
aplicación web de Arlo, y un cambio en Arlo puede romperla hasta una
actualización.
