!macro customInstall
  ; Retain the verified installer as the base for the next differential update.
  ; Failure to cache never prevents installation: the updater can use the full package.
  SetShellVarContext current
  CreateDirectory "$APPDATA\${PRODUCT_NAME}\updates"
  StrCmp "$EXEPATH" "$APPDATA\${PRODUCT_NAME}\updates\EDUPLINK-Setup-${VERSION}.exe" cache_done
  ClearErrors
  CopyFiles /SILENT "$EXEPATH" "$APPDATA\${PRODUCT_NAME}\updates\EDUPLINK-Setup-${VERSION}.exe"
  cache_done:
  ClearErrors
!macroend
