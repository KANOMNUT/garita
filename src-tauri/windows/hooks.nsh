; Garita NSIS installer hooks (v2.1.3 K4/K5): add/remove $INSTDIR on the USER PATH (HKCU\Environment).
;
; Safety rule: this file never writes a PATH it did not read in full and never builds one that
; does not fit. NSIS_MAX_STRLEN is 1024 here and there is no EnVar plugin, so:
;   - ReadRegStr sets the error flag -> PATH is left untouched;
;   - the new value is only built when StrLen(PATH)+1+StrLen($INSTDIR) < 1000;
;   - only the exact entry (case-insensitive, ';'-delimited) is added or removed;
;   - the value is written back with WriteRegExpandStr to keep REG_EXPAND_SZ.
; A user whose PATH is too long gets no command; Settings -> Command line shows the folder.
; ponytail: 1000-char cap; the upgrade is to edit the registry from the app (no length limit).

!include "WinMessages.nsh"

; Scan: in $0 = PATH, $1 = entry; out $2 = index of ";entry;" in ";PATH;" or -1, $4 = ";PATH;",
; $6 = length of ";entry;". Callers save and restore $0-$9.
!macro GaritaScanFunc P
Function ${P}GaritaScanOne
  StrCpy $4 ";$0;"
  StrCpy $3 ";$1;"
  StrLen $6 $3
  StrLen $5 $4
  IntOp $5 $5 - $6
  StrCpy $2 0
  scan_loop:
    IntCmp $2 $5 scan_check scan_check scan_none
  scan_check:
    StrCpy $7 $4 $6 $2
    StrCmp $7 $3 scan_done
    IntOp $2 $2 + 1
    Goto scan_loop
  scan_none:
    StrCpy $2 -1
  scan_done:
FunctionEnd

; Matches the entry as given, then with a trailing backslash (a hand-added "...\Garita\"), so
; it is neither duplicated on install nor left behind on uninstall. $1 is restored on a miss.
Function ${P}GaritaScan
  Call ${P}GaritaScanOne
  StrCmp $2 -1 0 scan2_done
  StrCpy $1 "$1\"
  Call ${P}GaritaScanOne
  StrCmp $2 -1 0 scan2_done
  StrCpy $1 $1 -1
  scan2_done:
FunctionEnd
!macroend

!insertmacro GaritaScanFunc ""
!insertmacro GaritaScanFunc "un."

Function GaritaPathAdd
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  ClearErrors
  ReadRegStr $0 HKCU "Environment" "Path"
  IfErrors add_unreadable
  StrCpy $1 $INSTDIR
  Call GaritaScan
  StrCmp $2 -1 add_new
  DetailPrint "Garita: install folder is already on the user PATH"
  Goto add_out
  add_new:
    StrLen $8 $0
    StrLen $9 $1
    IntOp $8 $8 + 1
    IntOp $8 $8 + $9
    IntCmp $8 1000 add_toolong add_fits add_toolong
  add_fits:
    StrCmp $0 "" add_only add_append
  add_only:
    StrCpy $5 $1
    Goto add_write
  add_append:
    StrCpy $5 "$0;$1"
  add_write:
    WriteRegExpandStr HKCU "Environment" "Path" $5
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    DetailPrint "Garita: added the install folder to the user PATH"
    Goto add_out
  add_unreadable:
    DetailPrint "Garita: user PATH could not be read in full; left untouched"
    Goto add_out
  add_toolong:
    DetailPrint "Garita: user PATH is too long to extend safely; left untouched"
  add_out:
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.GaritaPathRemove
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  ClearErrors
  ReadRegStr $0 HKCU "Environment" "Path"
  IfErrors rm_out
  ; ";PATH;" is built in a 1023-char register: a PATH of 1000+ chars could be truncated on
  ; write-back, so it is left untouched (an entry we added stays; see launcher.md).
  StrLen $8 $0
  IntCmp $8 1000 rm_toolong rm_go rm_toolong
  rm_toolong:
    DetailPrint "Garita: user PATH is too long to edit safely; left untouched"
    Goto rm_out
  rm_go:
  StrCpy $1 $INSTDIR
  Call un.GaritaScan
  StrCmp $2 -1 rm_out
  ; ";PATH;" = left + ";entry;" + right  ->  left + ";" + right, then drop the two pad chars.
  StrCpy $9 $4 $2
  IntOp $8 $2 + $6
  StrCpy $7 $4 "" $8
  StrCpy $5 "$9;$7"
  StrCpy $5 $5 "" 1
  StrLen $8 $5
  StrCmp $8 0 rm_write
  IntOp $8 $8 - 1
  StrCpy $9 $5 1 $8
  StrCmp $9 ";" 0 rm_write
  StrCpy $5 $5 $8
  rm_write:
    ; Even when our entry was the only one: write "" so the value stays what it was before install.
    WriteRegExpandStr HKCU "Environment" "Path" $5
    SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
  rm_out:
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Call GaritaPathAdd
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Call un.GaritaPathRemove
!macroend
