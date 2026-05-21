; Yoda installer — runs after main install
; Checks for Python and installs required packages

!macro customInstall
  ; Check if Python is installed
  nsExec::ExecToLog 'python --version'
  Pop $0
  ${If} $0 != 0
    ; Python not found — prompt user
    MessageBox MB_YESNO "Yoda needs Python 3.x to use voice features.$\n$\nWould you like to open python.org to download it?" IDYES downloadPython IDNO skipPython
    downloadPython:
      ExecShell "open" "https://www.python.org/downloads/"
      MessageBox MB_OK "Please install Python, make sure to check 'Add Python to PATH', then run Yoda again."
    skipPython:
  ${Else}
    ; Python found — install required packages silently
    DetailPrint "Installing Python packages for voice features..."
    nsExec::ExecToLog 'python -m pip install vosk sounddevice numpy pyautogui Pillow edge-tts pygame --quiet --no-warn-script-location'
  ${EndIf}
!macroend

!macro customUnInstall
!macroend
