' Lance OMNI pour MESURER les deux defauts du 09/09, en une seule session.
'
' 1. LE DIALOGUE EN RETARD. Le maitre parle a un PNJ, les mules rejouent imp /
'    inh / kiy avec l etalement (16 a 80 ms cumules par esclave). Ce qu on vient
'    chercher: l ORDRE et la DATE d ecriture de chaque rejeu chez chaque mule,
'    lignes « rejeu imp ecrit (+N ms) », et ce que le serveur repond ensuite.
'
' 2. L ECHANGE QUI NE SE VALIDE PLUS. La proposition `jyv` et l acceptation
'    partent (mesure du 08/09), c est la suite qui manque: le message
'    « partenaire pret » (`kcb` au 08/09, champs 2 = coche, 3 = qui) et la
'    validation `kcs`. Le journal dira si `kcb` arrive encore sous ce nom, avec
'    quels champs, et ce que l accepteur en fait — ses refus s ecrivent ici et
'    NULLE PART AILLEURS (« echange : ... »).
'
' CETTE MESURE SE FAIT REPLICATE ALLUME, contrairement a celle des songes: le
' premier defaut EST dans le rejeu.
'
' 4096 octets par trame: un arbre de dialogue est bavard. Ce qui deborde est
' signale, jamais tronque en silence.
'
' Le journal va dans son PROPRE fichier, journal-bug-0909.log.
Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-bug-0909.log"
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
