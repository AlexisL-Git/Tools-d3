' Lance OMNI pour MESURER un dialogue de PNJ.
'
' Jumeau de lancer-mesure-groupe.vbs. Le dialogue passe par trois messages,
' tous deja repertories dans src/protocol/omni.js depuis le remappage du 08/09:
'
'   imp   NpcGenericActionRequest   ouvrir le dialogue (1 = acheter/vendre, 3 = parler)
'   inh   NpcDialogReplyRequest     choisir une reponse dans l arbre
'   kiy   DialogLeaveRequest        fermer
'
' CE QU ON VIENT CHERCHER, ce sont leurs VALEURS: le npcId de chaque PNJ et
' l identifiant de reponse de chaque choix. Les types, eux, sont connus.
'
' 4096 octets: un arbre de dialogue est plus bavard qu une invitation. Ce qui
' deborde est signale, jamais tronque en silence.
'
' PREMIER USAGE, le 08/09 au soir: le PNJ des SONGES qui donne un boost. Seul
' le maitre doit lui parler — les mules n'ont rien a y faire. La mesure se fait
' donc REPLICATE COUPE, interrupteur eteint dans la fenetre d'OMNI: enregistrer
' et rejouer sont deux chaines separees, couper la seconde ne prive la premiere
' de rien.
'
' Le journal va dans son PROPRE fichier, journal-dialogue.log.
Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-dialogue.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS_MAX") = "4096"

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
