' Lance OMNI pour MESURER les trames d une AME PLEINE.
'
' Outil de mesure. Il sert au spike du TABLEAU DES ARCHIMONSTRES: on ne sait
' pas encore si l identifiant du monstre capture se lit dans l inventaire.
'
' Identique a lancer-mesure-hdv.vbs, au fichier de journal pres. Les deux
' variables qui comptent:
'   OMNI_CAPTURE=1          toutes les trames, dans les deux sens
'   OMNI_CAPTURE_OCTETS=1   leurs octets bruts en hexadecimal
'
' LES OCTETS SONT LE POINT, et plus encore ici que pour l hotel de vente. La
' capture seule resume tout champ imbrique en `{…}`, or c est EXACTEMENT dans
' ces champs — les effets d une pile, champ 2 du detail — que l identite du
' monstre doit se trouver. Sans les octets, le journal repeterait `2={…}` sans
' rien apprendre.
'
' CE QU IL FAUT FAIRE UNE FOIS LANCE: connecter le personnage qui porte des
' pierres d ame PLEINES. Rien d autre. L inventaire (`ivx`) tombe tout seul a
' la connexion, sans ouvrir aucun panneau — mesure du 2026-09-03, 471 piles.
'
' Le journal va dans son PROPRE fichier, journal-archi.log: une mesure qu on
' relit pendant des jours ne doit pas etre effacee par le prochain lancement de
' diagnostic ordinaire, ni ecraser celle de l hotel de vente.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-archi.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"

' Meme borne que la mesure de l hotel de vente: le plus gros paquet du login
' fait 89 746 octets, et un inventaire de 471 piles avec tous ses effets est du
' meme ordre. 2 Ko avaient coupe la mesure du 01/09 sans rien apprendre de la
' fin des listes.
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

' 1 = fenetre normale, False = on n attend pas la fin.
sh.Run cible, 1, False
