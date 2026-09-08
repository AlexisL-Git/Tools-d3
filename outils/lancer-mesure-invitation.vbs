' Lance OMNI pour MESURER les trames d'invitation de groupe (et de songe).
'
' Outil de mesure, ecrit le 08/09 apres le constat que l'acceptation
' automatique des invitations etait ETEINTE depuis le patch 3.6.11.12: `ijz` et
' `ijx` ne designent plus rien, et aucune des cinq captures du 08/09 ne
' contient d'invitation — le geste n'a pas ete fait ce jour-la. Sans mesure, le
' remappage est impossible: choisir un nom au hasard ferait agir la fonction a
' cote.
'
' Identique a lancer-mesure-hdv.vbs, au fichier de journal pres.
'
' LE GESTE A FAIRE, une fois les DEUX clients attaches et connectes:
'
'   1. depuis le compte A, inviter le compte B dans un groupe;
'   2. sur B, accepter A LA MAIN (l'acceptation automatique ne partira pas,
'      c'est justement ce qu'on repare) — l'acceptation sortante est le second
'      nom qu'on vient chercher;
'   3. quitter le groupe;
'   4. si le songe se mesure dans la foulee: lancer un songe depuis A, laisser
'      l'invitation arriver sur B, l'accepter a la main.
'
' Puis, depot ouvert:
'
'   node outils/apparier-protocole.js journal-invitation.log
'
' L'empreinte de `ijz` porte six champs dont une chaine — la plus discriminante
' du catalogue — donc une seule invitation captee devrait rendre UN candidat.
' Celle de `ijx` (`1:varint`) est banale: c'est la CHRONOLOGIE qui la tranche,
' la requete sortante qui part de B au moment du clic, quelques secondes apres
' l'invitation entrante.
'
' Le journal va dans son PROPRE fichier, journal-invitation.log: une mesure
' qu'on relit ne doit pas etre effacee par le prochain diagnostic ordinaire.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-invitation.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"

' Meme plafond que la mesure HDV. L'invitation elle-meme fait une trentaine
' d'octets, mais le paquet de login en fait 89 746 et le tronquer masquerait
' des trames voisines utiles a la chronologie.
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS_MAX") = "262144"

exe = racine & "\desktop\dist\OMNI-win32-x64\OMNI.exe"
args = ""
If Not fso.FileExists(exe) Then
  exe = racine & "\node_modules\electron\dist\electron.exe"
  args = " """ & racine & "\amorceur\electron.js"""
End If

If Not fso.FileExists(exe) Then
  MsgBox "OMNI est introuvable." & vbCrLf & vbCrLf & _
         "Ni le paquet (desktop\dist\OMNI-win32-x64\OMNI.exe)," & vbCrLf & _
         "ni Electron (node_modules). Lance npm install dans :" & vbCrLf & _
         racine, 16, "OMNI"
  WScript.Quit 1
End If

cible = """" & exe & """" & args

' 1 = fenetre normale, False = on n'attend pas la fin.
sh.Run cible, 1, False
