' Lance OMNI pour MESURER les trames de l'hotel de vente.
'
' Outil de mesure. Il a servi a etablir
' docs\superpowers\specs\2026-09-01-trames-hdv.md, et il reste pour le spike de
' la MISE EN VENTE, qui aura besoin des memes octets.
'
' Identique a lancer-diag.vbs, a deux variables pres:
'   OMNI_CAPTURE=1          toutes les trames, dans les deux sens
'   OMNI_CAPTURE_OCTETS=1   leurs octets bruts en hexadecimal
'
' LES OCTETS SONT LE POINT. La capture seule resume tout champ imbrique en
' `{…}`. Cela suffisait pour l'echange et le passe-tour, dont les trames sont
' plates. Un contenu de banque et une liste de prix sont des LISTES de
' messages: sans les octets, le journal repeterait `2={…}` sans rien apprendre.
'
' Le journal va dans son PROPRE fichier, journal-hdv.log, et pas dans
' journal-dev.log: une mesure qu'on relit pendant des jours ne doit pas etre
' effacee par le prochain lancement de diagnostic ordinaire.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-hdv.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"

' La liste des lots en vente fait 8908 octets, le plus gros paquet du login
' 89 746. La premiere mesure les a coupes a 2 Ko et n'a rien appris de leur
' fin. 256 Ko passent tout, et le journal reste lisible: hors combat le flux se
' compte en dizaines de trames par minute.
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
