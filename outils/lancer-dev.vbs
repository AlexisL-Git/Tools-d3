' Lance OMNI en mode developpement, sans fenetre de console.
'
' Le mode developpement charge le code du depot TEL QUEL: ni cle demandee, ni
' interrogation du service, ni mise a jour. Modifier un fichier et relancer
' suffit. Sans OMNI_DEV, la meme application se comporte comme chez un ami.
'
' La racine du depot est deduite de l'emplacement de ce fichier, donc le
' raccourci reste valide si le depot demenage, et il marche aussi chez Draxus.
'
' On prefere le binaire PACKAGE quand il existe: il porte l'icone d'OMNI, ce
' qui compte pour un raccourci epingle a la barre des taches. A defaut, on
' retombe sur l'Electron de node_modules, qui fait tourner exactement le meme
' code.

Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Herite par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine

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
