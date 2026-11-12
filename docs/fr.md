# Intégration Arlo

Ajoute vos caméras, sonnettes vidéo, bases et sirènes Arlo dans Gladys : images,
mouvement, batterie, modes Arlo (armé, désarmé, personnalisés), sirène, scènes
et widgets du tableau de bord.

> **Intégration cloud.** Arlo n’a pas d’API locale : tout passe par le cloud
> Arlo, avec votre compte Arlo. Gladys a besoin d’une connexion internet, et
> Arlo doit être joignable.

## Ce que vous obtenez

| Appareil Arlo                   | Dans Gladys                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| Caméra (Pro, Ultra, Essential…) | Image, caméra allumée/éteinte (mode privé Arlo), mouvement, batterie     |
| Sonnette vidéo                  | Comme une caméra, plus « Sonnerie »                                      |
| Sonnette audio                  | Sonnerie, batterie                                                       |
| Base (hub)                      | Mode Arlo (liste des modes de la base), sirène sur les bases Pro         |
| Caméra Wi-Fi sans base          | Fonctions caméra, plus son propre mode Arlo et sa sirène (Pro 3 et plus) |
| Sirène Arlo                     | Sirène marche/arrêt                                                      |

Pas (encore) pris en charge : flux vidéo en direct, lampes et carillons Arlo.

## Installation

1. **Conseil :** créez un second compte Arlo pour Gladys et partagez-lui vos
   appareils depuis l’application Arlo (Paramètres → Accorder l’accès). Arlo
   n’autorise qu’une session web par compte : utiliser votre compte principal
   dans Gladys peut vous déconnecter de my.arlo.com, et inversement.
2. Dans Gladys, ouvrez la configuration de l’intégration et remplissez :
   - **E-mail Arlo** et **Mot de passe Arlo** ;
   - **Code de vérification envoyé par** : e-mail ou SMS (la méthode doit être
     active sur le compte Arlo).
3. Enregistrez, puis cliquez sur **M’envoyer un code**. Arlo envoie un code par
   e-mail ou SMS.
4. Saisissez le code dans **Valider le code** (sous 10 minutes).
5. Le statut passe au vert. Ouvrez l’onglet **Découverte** et ajoutez vos
   appareils.

La connexion est gardée dans l’intégration (`/data`) et réutilisée à chaque
redémarrage. Quand Arlo y met fin (en général au bout de quelques semaines), le
statut demande un nouveau code : cliquez à nouveau sur **M’envoyer un code**.

### Options

| Option                         | Par défaut | Rôle                                                                                                           |
| ------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------- |
| Intervalle de rafraîchissement | 60 s       | Fréquence de lecture des modes, batteries, images et enregistrements. Une minute minimum.                      |
| Image fraîche à la demande     | non        | Quand Gladys demande une image, la caméra en prend une nouvelle. Réveille les caméras sur batterie : ça l’use. |
| Logs détaillés                 | non        | Écrit chaque événement Arlo dans les logs. Utile pour signaler un problème, à désactiver ensuite.              |

Le bouton **Tester la connexion** vérifie la connexion et relit la liste des
appareils.

## Fonctionnement

- **Temps réel :** mouvement, appui sur la sonnette, batterie, mode privé et
  sirène arrivent par le flux d’événements Arlo.
- **À chaque rafraîchissement :** l’intégration lit la liste des appareils
  (nouvelle image de chaque caméra), les modes actifs et les enregistrements des
  dernières 24 heures.
- **Images :** Gladys accepte des images de caméra jusqu’à 150 Ko. Les images
  Arlo plus lourdes sont réduites par l’intégration.
- Certains comptes Arlo ne reçoivent pas le flux temps réel. Mouvement,
  changements de mode et détections intelligentes arrivent quand même, mais
  jusqu’à un rafraîchissement plus tard.

## Scènes

### Déclencheurs

| Clé                | Quand                                                                                                           | Filtres                                                     | Variables           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------- |
| `motion_detected`  | Une caméra a vu quelque chose bouger.                                                                           | Caméra                                                      | –                   |
| `object_detected`  | La détection intelligente Arlo a reconnu ce qui a bougé (abonnement Arlo Secure). Arrive avec l’enregistrement. | Caméra, ce qui a été vu (personne, véhicule, animal, colis) | `object`            |
| `doorbell_pressed` | Quelqu’un a appuyé sur une sonnette.                                                                            | Sonnette                                                    | –                   |
| `mode_changed`     | Une base a changé de mode (application Arlo, planning, géorepérage). Pas déclenché quand Gladys l’a changé.     | Base, nouveau mode (armé, désarmé, personnalisé)            | `mode`, `mode_name` |

Utilisez les variables dans les actions suivantes, par exemple
`{{triggerEvent.data.object}}`.

### Actions

| Clé             | Rôle                                                                                                       | Résultat               |
| --------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| `set_mode`      | Passe une base dans un mode : `armed`, `disarmed`, ou le nom d’un mode personnalisé (ex. `Nuit`).          | `changed`, `mode_name` |
| `take_snapshot` | La caméra prend une nouvelle photo, affichée dans Gladys. Enchaînez avec « Envoyer l’image de la caméra ». | `taken`                |
| `sound_siren`   | Fait sonner une sirène pendant une durée (5 à 300 s) et à un volume (1 à 8).                               | `started`              |

Les actions standard de Gladys marchent aussi sur les fonctions : allumer ou
éteindre une caméra, choisir le « Mode Arlo », arrêter la sirène.

## Widgets du tableau de bord

- **Arlo : vue d’ensemble** (`arlo_overview`) : le mode de chaque base, la
  batterie de chaque caméra, les derniers enregistrements avec leur miniature,
  et deux boutons : **Tout armer** / **Tout désarmer**.
- **Caméra Arlo** (`arlo_camera`) : choisissez une caméra. Affiche sa dernière
  image, batterie et mouvement en direct, son état et son dernier
  enregistrement, avec les boutons **Prendre une photo** et **Allumer /
  Éteindre**.

## Dépannage

| Problème                                 | Que faire                                                                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| « Arlo demande un code de vérification » | Cliquez sur **M’envoyer un code**, puis **Valider le code**.                                                                       |
| « No email verification method… »        | Choisissez l’autre méthode (SMS), ou ajoutez-la dans l’application Arlo (Paramètres → Vérification en deux étapes).                |
| « Invalid credentials »                  | Vérifiez l’e-mail et le mot de passe. Connectez-vous une fois sur my.arlo.com pour être sûr.                                       |
| Refus avec HTTP 403                      | La porte d’entrée d’Arlo a bloqué la requête. Attendez quelques minutes et réessayez ; si ça dure, ouvrez un ticket avec les logs. |
| Pas de valeur de batterie                | Attendez le prochain rafraîchissement : Arlo l’envoie par le flux d’événements.                                                    |
| La détection ne se déclenche pas         | La détection intelligente (personne, véhicule…) demande un abonnement Arlo Secure ; le mouvement seul non.                         |

Pour signaler un problème, activez **Logs détaillés**, reproduisez-le, et
joignez les logs de l’intégration (Gladys → Intégrations → Arlo → Logs) à un
ticket GitHub. Les logs ne contiennent jamais votre mot de passe ni votre
jeton.

## Vie privée

Votre e-mail, votre mot de passe et votre session Arlo restent dans votre
Gladys. L’intégration ne parle qu’aux serveurs Arlo (domaines `arlo.com`). Arlo
ne publie pas d’API officielle : cette intégration utilise les mêmes appels que
l’application web Arlo, et un changement chez Arlo peut la casser jusqu’à une
mise à jour.
