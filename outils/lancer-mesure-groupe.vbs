' Lance OMNI pour MESURER l'invitation de groupe et les songes.
'
' Outil de mesure, jumeau de lancer-mesure-combat.vbs. Il existe parce que ces
' deux fonctions sont les SEULES que le remappage du 08/09 (patch 3.6.11.12)
' n'a pas pu reparer: la seance de mesure de ce jour-la ne contenait ni
' invitation de groupe, ni songe. src/invitation.js porte encore ijz et ijx,
' src/songes.js encore ixf, iyd et ixk — des noms qui ne designent plus rien.
'
' LES DEUX SE MESURENT DANS LA MEME SEANCE, et il faut DEUX clients attaches:
' une invitation ne s'envoie pas a soi-meme.
'
'   1. le client A invite le client B dans son groupe, on accepte A LA MAIN sur B
'   2. quelques secondes plus tard, le client A lance un songe et invite B,
'      on accepte A LA MAIN sur B
'
' ESPACER LES DEUX ACCEPTATIONS, ET NOTER L'HEURE DE CHACUNE. `ijx` (accepter
' un groupe) et `ixk` (accepter un songe) sont deux requetes sortantes a un
' seul varint: leur empreinte est IDENTIQUE, et l'appariement structurel ne les
' separera pas. Seule la chronologie le fera.
'
' Puis:   node outils/apparier-protocole.js journal-groupe.log
'
' 2048 octets: l'invitation mesuree le 20/08 en faisait 57, et le contenu de
' `ixf` n'a jamais ete decode — la marge est la pour lui. Ce qui deborde est
' signale, jamais tronque en silence.
'
' Le journal va dans son PROPRE fichier, journal-groupe.log: journal-dev.log
' est REECRIT a chaque lancement, et une mesure perdue est une soiree perdue.
Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-groupe.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS_MAX") = "2048"

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
