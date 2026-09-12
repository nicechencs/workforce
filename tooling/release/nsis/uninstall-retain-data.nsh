; Uninstall must not remove the Daemon state directory.
; electron-builder: nsis.deleteAppDataOnUninstall = false
!macro customUnInstall
  ; Intentionally empty: retain %APPDATA%\Workforce
!macroend
