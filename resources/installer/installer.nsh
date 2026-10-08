; PaperForge additions to the electron-builder NSIS wizard.
;
; - The install is always for the current user, so the install-mode page is
;   skipped and no administrator rights are asked for.
; - An "Additional tasks" page offers a desktop shortcut and offering
;   PaperForge for PDF files. The association writes exactly the keys
;   src/main/services/windows/fileAssociation.ts writes, so Settings → Windows
;   in PaperForge reads and can undo what Setup did, and the uninstaller
;   takes it all away again.

!include nsDialogs.nsh
!include LogicLib.nsh

!define PF_PROG_ID "PaperForge.Document"
!define PF_CLASSES "Software\Classes"
!define PF_CAPABILITIES "Software\PaperForge\Capabilities"

!ifndef BUILD_UNINSTALLER
  Var PfDesktopShortcut
  Var PfAssociate
  Var PfDesktopCheckbox
  Var PfAssociateCheckbox
!endif

!macro customInit
  StrCpy $PfDesktopShortcut ${BST_CHECKED}
  StrCpy $PfAssociate ${BST_CHECKED}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customPageAfterChangeDir
  Page custom PfTasksPageCreate PfTasksPageLeave

  Function PfTasksPageCreate
    !insertmacro MUI_HEADER_TEXT "Additional tasks" "Choose what else Setup should do."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 12u "Create a &desktop shortcut"
    Pop $PfDesktopCheckbox
    ${NSD_SetState} $PfDesktopCheckbox $PfDesktopShortcut

    ${NSD_CreateCheckbox} 0 18u 100% 12u "&Open PDF files with PaperForge (adds it to Open with)"
    Pop $PfAssociateCheckbox
    ${NSD_SetState} $PfAssociateCheckbox $PfAssociate

    ${NSD_CreateLabel} 12u 34u -12u 40u "Windows lets only you choose the default PDF app. To make PaperForge the default, pick it the first time you open a PDF, or in Settings > Apps > Default apps."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function PfTasksPageLeave
    ${NSD_GetState} $PfDesktopCheckbox $PfDesktopShortcut
    ${NSD_GetState} $PfAssociateCheckbox $PfAssociate
  FunctionEnd
!macroend

!macro PfRegisterPdf
  WriteRegStr HKCU "${PF_CLASSES}\${PF_PROG_ID}" "" "PDF Document"
  WriteRegStr HKCU "${PF_CLASSES}\${PF_PROG_ID}" "FriendlyTypeName" "PDF Document"
  WriteRegStr HKCU "${PF_CLASSES}\${PF_PROG_ID}\DefaultIcon" "" '"$appExe",0'
  WriteRegStr HKCU "${PF_CLASSES}\${PF_PROG_ID}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr HKCU "${PF_CLASSES}\.pdf\OpenWithProgids" "${PF_PROG_ID}" ""
  WriteRegStr HKCU "${PF_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PF_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr HKCU "${PF_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr HKCU "${PF_CAPABILITIES}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${PF_CAPABILITIES}" "ApplicationDescription" "View, edit, organise and protect PDF documents, entirely offline."
  WriteRegStr HKCU "${PF_CAPABILITIES}\FileAssociations" ".pdf" "${PF_PROG_ID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PRODUCT_NAME}" "${PF_CAPABILITIES}"
!macroend

!macro PfUnregisterPdf
  DeleteRegValue HKCU "${PF_CLASSES}\.pdf\OpenWithProgids" "${PF_PROG_ID}"
  DeleteRegKey HKCU "${PF_CLASSES}\${PF_PROG_ID}"
  DeleteRegKey HKCU "${PF_CLASSES}\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\PaperForge"
!macroend

!macro customInstall
  ${If} $PfDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  ${Else}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}

  ${If} $PfAssociate == ${BST_CHECKED}
    !insertmacro PfRegisterPdf
  ${Else}
    !insertmacro PfUnregisterPdf
  ${EndIf}

  ; Tell Explorer the associations changed.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ; An update runs the old uninstaller first; the new install then applies the
  ; choices made on its own wizard, so there is nothing to take away here.
  ${IfNot} ${isUpdated}
    WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    !insertmacro PfUnregisterPdf
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
