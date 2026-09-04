' Lance OMNI pour MESURER le bug du 2026-09-04: un personnage qui REJOINT un
' combat deja lance n equipe pas sa pierre d ame.
'
' Modele: lancer-mesure-archi.vbs d Alexis. Deux differences, voulues.
'
' PAS D OCTETS BRUTS. La mesure de l ame pleine en avait besoin, l identite du
' monstre etant enfouie dans les effets d une pile. Ici les trois trames qui
' decident sont deja lues par src/pda-archi/trames.js: `kmu` porte un entier
' plat, `jss` et `kmk` sont resumees mais leur seule presence suffit. Les
' octets ne feraient que noyer le journal, et un combat en produit deja
' plusieurs milliers de lignes.
'
' SON PROPRE FICHIER, journal-archi-bug.log: ne pas ecraser la mesure de l ame
' pleine (journal-archi.log) ni celle de l hotel de vente.
'
' CE QU IL FAUT FAIRE UNE FOIS LANCE: voir le protocole, deux combats, un
' temoin qui marche puis le cas casse.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-archi-bug.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"

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

sh.Run cible, 1, False
