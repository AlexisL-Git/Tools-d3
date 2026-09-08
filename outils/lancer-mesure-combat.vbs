' Lance OMNI pour MESURER les trames du COMBAT.
'
' Outil de mesure, jumeau de lancer-mesure-hdv.vbs, a deux reglages pres qui
' tiennent tous les deux au VOLUME.
'
' Un combat produit plusieurs milliers de trames la ou le HDV en produit des
' dizaines par minute. C'est ce qui avait impose, en aout, de mesurer en deux
' passes: decouverte d'abord, octets ensuite, parce qu'un journal ou chaque
' trame traine son hexadecimal complet devient illisible.
'
' Une passe unique redevient possible en BORNANT le dump: les trames qui nous
' interessent sont minuscules — jyj ne porte aucun champ, jzc en porte trois —
' et 512 octets les passent en entier. Ce qui deborde est signale, jamais
' tronque en silence.
'
' Le journal va dans son PROPRE fichier, journal-combat.log: une mesure de
' combat ne doit pas effacer celle du HDV, ni l'inverse.
Option Explicit

Dim fso, sh, racine, exe, args, cible

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

racine = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

' Heritees par le process lance juste apres.
sh.Environment("PROCESS")("OMNI_DEV") = racine
sh.Environment("PROCESS")("OMNI_JOURNAL") = "complet"
sh.Environment("PROCESS")("OMNI_JOURNAL_FICHIER") = racine & "\journal-combat.log"
sh.Environment("PROCESS")("OMNI_CAPTURE") = "1"
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS") = "1"

' 512 octets: assez pour toute trame de combat, et le journal reste ouvrable.
' Le gros paquet du login (89 746 o) sera signale comme tronque, ce qui est
' sans consequence ici — on ne vient pas mesurer le login.
sh.Environment("PROCESS")("OMNI_CAPTURE_OCTETS_MAX") = "512"

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
