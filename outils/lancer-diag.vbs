' Lance OMNI en mode developpement AVEC le journal complet dans un fichier.
'
' Identique a lancer-dev.vbs, a deux variables pres:
'   OMNI_JOURNAL=complet          allume le journal detaille
'   OMNI_JOURNAL_FICHIER=...      l'ecrit dans <racine>\journal-dev.log
'
' Le fichier est INDISPENSABLE: lance par un raccourci, OMNI n'a pas de console
' attachee et tout ce que console.log ecrit est perdu. Un diagnostic muet
' ressemble alors trait pour trait a un diagnostic qui n'a rien vu.
'
' Le fichier est REMIS A ZERO a chaque lancement: un journal de combat doit
' pouvoir se lire en entier sans demeler deux sessions.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-dev.log"

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
