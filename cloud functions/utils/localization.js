// locale 기반 언어 감지 헬퍼
function detectLanguageFromLocale(locale) {
  if (locale) {
    const localeLower = locale.toLowerCase();
    if (localeLower.startsWith("ko") || localeLower.includes("korean")) {
      return "ko";
    } else if (
      localeLower.startsWith("en") ||
      localeLower.includes("english")
    ) {
      return "en";
    } else if (
      localeLower.startsWith("ja") ||
      localeLower.includes("japanese")
    ) {
      return "ja";
    } else if (localeLower.startsWith("de") || localeLower.includes("german")) {
      return "de";
    } else if (localeLower.startsWith("fr") || localeLower.includes("french")) {
      return "fr";
    } else if (
      localeLower.startsWith("it") ||
      localeLower.includes("italian")
    ) {
      return "it";
    } else if (
      localeLower.startsWith("zh") ||
      localeLower.includes("chinese")
    ) {
      return "zh";
    } else if (
      localeLower.startsWith("es") ||
      localeLower.includes("spanish")
    ) {
      return "es";
    }
    // 지원하지 않는 언어면 영어로 fallback
    return "en";
  }

  // 기본값: 영어
  return "en";
}

// locale 기반 에러 메시지 반환
function getLocalizedErrorMessage(locale, errorType) {
  const lang = detectLanguageFromLocale(locale);

  const messages = {
    QUOTA_EXCEEDED_TOKEN: {
      ko: "월 토큰 한도를 초과했습니다.",
      en: "Monthly token limit exceeded.",
      ja: "月間トークン制限を超えました。",
      de: "Monatliches Token-Limit überschritten.",
      fr: "Limite mensuelle de jetons dépassée.",
      it: "Limite mensile di token superata.",
      zh: "已超出每月 token 上限。",
      es: "Se ha excedido el límite mensual de tokens."
    },
    QUOTA_EXCEEDED_DATASET: {
      ko: "데이터셋 개수 한도를 초과했습니다. (최대 {max}개)",
      en: "Data set limit exceeded (max {max}).",
      ja: "データセット数の上限を超えました。（最大{max}件）",
      de: "Datensatzlimit überschritten (max. {max}).",
      fr: "Limite de jeux de données dépassée (max. {max}).",
      it: "Limite set di dati superato (max {max}).",
      zh: "已超出資料集數量上限（最多 {max} 個）。",
      es: "Límite de conjuntos de datos excedido (máx. {max})."
    },
    TENANT_NOT_FOUND: {
      ko: "계정 정보를 찾을 수 없습니다.",
      en: "We couldn't find your account information.",
      ja: "アカウント情報が見つかりません。",
      de: "Ihre Kontoinformationen konnten nicht gefunden werden.",
      fr: "Impossible de trouver les informations de votre compte.",
      it: "Non e stato possibile trovare le informazioni del tuo account.",
      zh: "找不到帳戶資料。",
      es: "No pudimos encontrar la información de tu cuenta."
    },
    TENANT_INACTIVE: {
      ko: "현재 계정을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
      en: "This account is not currently available. Please contact support.",
      ja: "このアカウントは現在利用できません。サポートへお問い合わせください。",
      de: "Dieses Konto ist derzeit nicht verfügbar. Bitte wenden Sie sich an den Support.",
      fr: "Ce compte n'est pas disponible pour le moment. Veuillez contacter le support.",
      it: "Questo account non e disponibile al momento. Contatta il supporto.",
      zh: "此帳戶目前無法使用，請聯絡支援團隊。",
      es: "Esta cuenta no está disponible en este momento. Ponte en contacto con soporte."
    },
    CHANNEL_DELETE_FORBIDDEN: {
      ko: "채널을 삭제할 권한이 없습니다.",
      en: "You do not have permission to delete this channel.",
      ja: "このチャンネルを削除する権限がありません。",
      de: "Sie haben keine Berechtigung, diesen Kanal zu löschen.",
      fr: "Vous n’avez pas l’autorisation de supprimer ce canal.",
      it: "Non hai l’autorizzazione per eliminare questo canale.",
      zh: "您沒有刪除此頻道的權限。",
      es: "No tienes permiso para eliminar este canal."
    },
    CHANNEL_ALREADY_DELETED: {
      ko: "이미 삭제된 채널입니다.",
      en: "This channel has already been deleted.",
      ja: "このチャンネルは既に削除されています。",
      de: "Dieser Kanal wurde bereits gelöscht.",
      fr: "Ce canal a déjà été supprimé.",
      it: "Questo canale è già stato eliminato.",
      zh: "此頻道已被刪除。",
      es: "Este canal ya fue eliminado."
    },
    CHANNEL_DELETE_SUCCESS: {
      ko: "채널이 삭제되었습니다.",
      en: "The channel has been deleted.",
      ja: "チャンネルが削除されました。",
      de: "Der Kanal wurde gelöscht.",
      fr: "Le canal a été supprimé.",
      it: "Il canale è stato eliminato.",
      zh: "頻道已刪除。",
      es: "El canal ha sido eliminado."
    },
    INVALID_STORAGE_PATH: {
      ko: "파일 경로가 올바르지 않습니다. 다시 업로드한 뒤 시도해 주세요.",
      en: "The file path is invalid. Please upload the file again and retry.",
      ja: "ファイルパスが正しくありません。ファイルを再アップロードしてお試しください。",
      de: "Der Dateipfad ist ungultig. Bitte laden Sie die Datei erneut hoch und versuchen Sie es noch einmal.",
      fr: "Le chemin du fichier n'est pas valide. Veuillez televerser a nouveau le fichier puis reessayer.",
      it: "Il percorso del file non e valido. Carica di nuovo il file e riprova.",
      zh: "檔案路徑無效，請重新上傳檔案後再試。",
      es: "La ruta del archivo no es valida. Vuelve a subir el archivo y reintentalo."
    },
    FILE_NOT_FOUND: {
      ko: "파일을 찾을 수 없습니다.",
      en: "File not found.",
      ja: "ファイルが見つかりません。",
      de: "Datei nicht gefunden.",
      fr: "Fichier introuvable.",
      it: "File non trovato.",
      zh: "找不到檔案。",
      es: "Archivo no encontrado."
    },
    NO_DATA_FOUND: {
      ko: "파일에서 데이터를 찾을 수 없습니다.",
      en: "No data found in file.",
      ja: "ファイルにデータが見つかりません。",
      de: "Keine Daten in der Datei gefunden.",
      fr: "Aucune donnée trouvée dans le fichier.",
      it: "Nessun dato trovato nel file.",
      zh: "檔案中找不到資料。",
      es: "No se encontraron datos en el archivo."
    },
    JSONL_PARSING_ERROR: {
      ko: "JSONL 파싱 중 오류가 발생했습니다.",
      en: "Error occurred while parsing JSONL file.",
      ja: "JSONLファイルの解析中にエラーが発生しました。",
      de: "Fehler beim Parsen der JSONL-Datei aufgetreten.",
      fr: "Erreur survenue lors de l'analyse du fichier JSONL.",
      it: "Si è verificato un errore durante l'analisi del file JSONL.",
      zh: "解析 JSONL 檔案時發生錯誤。",
      es: "Error al analizar el archivo JSONL."
    },
    INVALID_TENANT_ID: {
      ko: "계정 정보가 올바르지 않습니다. 다시 시도해 주세요.",
      en: "Your account information is invalid. Please try again.",
      ja: "アカウント情報が正しくありません。もう一度お試しください。",
      de: "Ihre Kontoinformationen sind ungültig. Bitte versuchen Sie es erneut.",
      fr: "Les informations de votre compte ne sont pas valides. Veuillez réessayer.",
      it: "Le informazioni del tuo account non sono valide. Riprova.",
      zh: "帳戶資料無效，請再試一次。",
      es: "La información de tu cuenta no es válida. Inténtalo de nuevo."
    },
    INVALID_DATASET_ID: {
      ko: "데이터셋 정보를 확인할 수 없습니다. 다시 시도해 주세요.",
      en: "We couldn't identify the data set. Please try again.",
      ja: "データセット情報を確認できませんでした。もう一度お試しください。",
      de: "Der Datensatz konnte nicht erkannt werden. Bitte versuchen Sie es erneut.",
      fr: "Impossible d’identifier le jeu de données. Veuillez réessayer.",
      it: "Non è stato possibile identificare il set di dati. Riprova.",
      zh: "無法識別資料集，請再試一次。",
      es: "No pudimos identificar el conjunto de datos. Inténtalo de nuevo."
    },
    TOO_MANY_ROWS: {
      ko: "행 수가 최대 허용치를 초과했습니다.",
      en: "Number of rows exceeds the maximum allowed limit.",
      ja: "行数が最大許容値を超えました。",
      de: "Die Anzahl der Zeilen überschreitet das maximal zulässige Limit.",
      fr: "Le nombre de lignes dépasse la limite maximale autorisée.",
      it: "Il numero di righe supera il limite massimo consentito.",
      zh: "資料列數量超出上限。",
      es: "El número de filas excede el límite máximo permitido."
    },
    TEXT_TOO_LONG: {
      ko: "텍스트 길이가 최대 허용치를 초과했습니다.",
      en: "Text length exceeds the maximum allowed limit.",
      ja: "テキストの長さが最大許容値を超えました。",
      de: "Die Textlänge überschreitet das maximal zulässige Limit.",
      fr: "La longueur du texte dépasse la limite maximale autorisée.",
      it: "La lunghezza del testo supera il limite massimo consentito.",
      zh: "文字長度超出上限。",
      es: "La longitud del texto excede el límite máximo permitido."
    },
    ALL_ROWS_DELETED: {
      ko: "모든 행이 삭제됩니다. 전체 삭제가 필요하면 데이터셋 삭제 API를 사용하세요.",
      en: "This would remove all rows. If you want to delete everything, please delete the data set instead.",
      ja: "すべての行が削除されます。完全に削除する場合はデータセット削除APIを使用してください。",
      de: "Dadurch würden alle Zeilen entfernt. Wenn Sie alles löschen möchten, löschen Sie stattdessen den Datensatz.",
      fr: "Cela supprimerait toutes les lignes. Si vous souhaitez tout supprimer, supprimez plutôt le jeu de données.",
      it: "In questo modo verrebbero rimosse tutte le righe. Se vuoi eliminare tutto, elimina invece il set di dati.",
      zh: "所有資料列都會被刪除。如需完整刪除，請改用資料集刪除 API。",
      es: "Esto eliminaría todas las filas. Si quieres borrarlo todo, elimina el conjunto de datos."
    },
    WORKER_ENQUEUE_FAILED: {
      ko: "작업 큐 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      en: "We couldn't start processing your data. Please try again shortly.",
      ja: "ワーカータスクのキュー登録に失敗しました。しばらくしてから再試行してください。",
      de: "Die Verarbeitung Ihrer Daten konnte nicht gestartet werden. Bitte versuchen Sie es in Kürze erneut.",
      fr: "Le traitement de vos données n’a pas pu démarrer. Veuillez réessayer dans un instant.",
      it: "Non è stato possibile avviare l'elaborazione dei tuoi dati. Riprova tra poco.",
      zh: "暫時無法開始處理你的資料，請稍後再試。",
      es: "No pudimos iniciar el procesamiento de tus datos. Inténtalo de nuevo en breve."
    },
    RTDB_USER_CREATE_FAILED: {
      ko: "회원 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      en: "We couldn't save your account information. Please try again shortly.",
      ja: "アカウント情報を保存できませんでした。しばらくしてからもう一度お試しください。",
      de: "Ihre Kontoinformationen konnten nicht gespeichert werden. Bitte versuchen Sie es in Kürze erneut.",
      fr: "Nous n’avons pas pu enregistrer les informations de votre compte. Veuillez réessayer dans un instant.",
      it: "Non è stato possibile salvare le informazioni del tuo account. Riprova tra poco.",
      zh: "無法儲存帳戶資料，請稍後再試。",
      es: "No pudimos guardar la información de tu cuenta. Inténtalo de nuevo en breve."
    },
    QUOTA_EXCEEDED: {
      ko: "할당량을 초과했습니다.",
      en: "Quota exceeded.",
      ja: "割り当てを超えました。",
      de: "Kontingent überschritten.",
      fr: "Quota dépassé.",
      it: "Quota superato.",
      zh: "已超出配額。",
      es: "Cuota excedida."
    },
    EMPTY_MESSAGE: {
      ko: "메시지가 비어있습니다.",
      en: "Message is empty.",
      ja: "メッセージが空です。",
      de: "Nachricht ist leer.",
      fr: "Le message est vide.",
      it: "Il messaggio è vuoto.",
      zh: "訊息為空。",
      es: "El mensaje está vacío."
    },
    MESSAGE_TOO_LONG: {
      ko: "메시지가 너무 깁니다. (최대 10,000자)",
      en: "Message is too long. (Maximum 10,000 characters)",
      ja: "メッセージが長すぎます。（最大10,000文字）",
      de: "Nachricht ist zu lang. (Maximal 10.000 Zeichen)",
      fr: "Le message est trop long. (Maximum 10 000 caractères)",
      it: "Il messaggio è troppo lungo. (Massimo 10.000 caratteri)",
      zh: "訊息過長。（最多 10,000 個字元）",
      es: "El mensaje es demasiado largo. (Máximo 10,000 caracteres)"
    },
    MESSAGE_TRUNCATED: {
      ko: "[메시지가 길어 일부만 표시됩니다]",
      en: "[Message is too long, only part is shown]",
      ja: "[メッセージが長すぎるため、一部のみ表示されます]",
      de: "[Nachricht ist zu lang, nur ein Teil wird angezeigt]",
      fr: "[Le message est trop long, seule une partie est affichée]",
      it: "[Il messaggio è troppo lungo, viene mostrata solo una parte]",
      zh: "[訊息過長，僅顯示部分內容]",
      es: "[El mensaje es demasiado largo, solo se muestra una parte]"
    },
    MISSING_QDRANT_URL: {
      ko: "검색 기능이 아직 올바르게 설정되지 않았습니다. 관리자에게 문의해 주세요.",
      en: "Search is not set up correctly right now. Please contact support.",
      ja: "現在、検索機能の設定に問題があります。サポートへお問い合わせください。",
      de: "Die Suche ist derzeit nicht korrekt eingerichtet. Bitte wenden Sie sich an den Support.",
      fr: "La recherche n’est pas correctement configurée pour le moment. Veuillez contacter le support.",
      it: "La ricerca non è configurata correttamente al momento. Contatta il supporto.",
      zh: "搜尋功能目前未完成設定，請聯絡支援團隊。",
      es: "La búsqueda no está configurada correctamente en este momento. Ponte en contacto con soporte."
    },
    QDRANT_DELETE_FAILED: {
      ko: "데이터를 완전히 업데이트하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      en: "We couldn't update your data completely. Please try again later.",
      ja: "データを完全に更新できませんでした。しばらくしてから再試行してください。",
      de: "Ihre Daten konnten nicht vollständig aktualisiert werden. Bitte versuchen Sie es später erneut.",
      fr: "Nous n’avons pas pu mettre à jour complètement vos données. Veuillez réessayer plus tard.",
      it: "Non siamo riusciti ad aggiornare completamente i tuoi dati. Riprova più tardi.",
      zh: "未能完整更新你的資料，請稍後再試。",
      es: "No pudimos actualizar tus datos por completo. Inténtalo de nuevo más tarde."
    },
    // Billing (Lemon Squeezy)
    BILLING_INVALID_VARIANT: {
      ko: "선택한 상품을 확인할 수 없거나 현재 지원되지 않습니다.",
      en: "The selected plan could not be found or is not supported.",
      ja: "選択したプランが見つからないか、現在サポートされていません。",
      de: "Der ausgewahlte Tarif wurde nicht gefunden oder wird derzeit nicht unterstutzt.",
      fr: "Le plan selectionne est introuvable ou n'est pas pris en charge actuellement.",
      it: "Il piano selezionato non e stato trovato o non e supportato al momento.",
      zh: "找不到所選方案，或此方案目前不受支援。",
      es: "No se encontro el plan seleccionado o no es compatible en este momento."
    },
    BILLING_CONFIG_ERROR: {
      ko: "결제 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.",
      en: "Payment configuration is not complete. Please try again later.",
      ja: "決済設定が完了していません。しばらくしてから再試行してください。",
      de: "Zahlungskonfiguration ist unvollständig. Bitte später erneut versuchen.",
      fr: "La configuration du paiement est incomplète. Veuillez réessayer plus tard.",
      it: "Configurazione pagamento incompleta. Riprova più tardi.",
      zh: "付款設定尚未完成，請稍後再試。",
      es: "La configuración de pago no está completa. Inténtelo de nuevo más tarde."
    },
    BILLING_CHECKOUT_FAILED: {
      ko: "결제 페이지를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      en: "Could not load checkout page. Please try again later.",
      ja: "決済ページを読み込めませんでした。しばらくしてから再試行してください。",
      de: "Checkout-Seite konnte nicht geladen werden. Bitte später erneut versuchen.",
      fr: "Impossible de charger la page de paiement. Veuillez réessayer plus tard.",
      it: "Impossibile caricare la pagina di checkout. Riprova più tardi.",
      zh: "無法載入付款頁面，請稍後再試。",
      es: "No se pudo cargar la página de pago. Inténtelo de nuevo más tarde."
    },
    BILLING_SUBSCRIPTION_NOT_FOUND: {
      ko: "구독을 찾을 수 없거나 이미 취소되었습니다.",
      en: "Subscription not found or already cancelled.",
      ja: "サブスクリプションが見つからないか、既にキャンセルされています。",
      de: "Abonnement nicht gefunden oder bereits gekündigt.",
      fr: "Abonnement introuvable ou déjà annulé.",
      it: "Sottoscrizione non trovata o già annullata.",
      zh: "找不到訂閱，或該訂閱已取消。",
      es: "Suscripción no encontrada o ya cancelada."
    },
    BILLING_CANCEL_FAILED: {
      ko: "구독 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      en: "Failed to cancel subscription. Please try again later.",
      ja: "サブスクリプションのキャンセルに失敗しました。しばらくしてから再試行してください。",
      de: "Abonnement konnte nicht gekündigt werden. Bitte später erneut versuchen.",
      fr: "Échec de l'annulation de l'abonnement. Veuillez réessayer plus tard.",
      it: "Impossibile annullare l'abbonamento. Riprova più tardi.",
      zh: "取消訂閱失敗，請稍後再試。",
      es: "Error al cancelar la suscripción. Inténtelo de nuevo más tarde."
    },
    BILLING_UPDATE_FAILED: {
      ko: "구독 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      en: "Failed to update subscription. Please try again later.",
      ja: "サブスクリプションの変更に失敗しました。しばらくしてから再試行してください。",
      de: "Abonnement konnte nicht aktualisiert werden. Bitte später erneut versuchen.",
      fr: "Échec de la mise à jour de l'abonnement. Veuillez réessayer plus tard.",
      it: "Impossibile aggiornare l'abbonamento. Riprova più tardi.",
      zh: "更新訂閱失敗，請稍後再試。",
      es: "No se pudo actualizar la suscripción. Inténtelo de nuevo más tarde."
    },
    BILLING_INVOICE_NOT_FOUND: {
      ko: "해당 구독 인보이스를 찾을 수 없습니다.",
      en: "Subscription invoice not found.",
      ja: "サブスクリプション請求書が見つかりません。",
      de: "Abonnement-Rechnung nicht gefunden.",
      fr: "Facture d'abonnement introuvable.",
      it: "Fattura dell'abbonamento non trovata.",
      zh: "找不到訂閱發票。",
      es: "Factura de suscripción no encontrada."
    },
    BILLING_FORBIDDEN: {
      ko: "이 테넌트의 결제를 관리할 권한이 없습니다.",
      en: "You do not have permission to manage billing for this tenant.",
      ja: "このテナントの請求を管理する権限がありません。",
      de: "Sie sind nicht berechtigt, die Abrechnung für diesen Mandanten zu verwalten.",
      fr: "Vous n’avez pas l’autorisation de gérer la facturation de ce locataire.",
      it: "Non hai l'autorizzazione per gestire la fatturazione di questo tenant.",
      zh: "您沒有管理此租戶帳務的權限。",
      es: "No tiene permiso para gestionar la facturación de este inquilino."
    },
    SOURCE_DOWNLOAD_FORBIDDEN: {
      ko: "이 테넌트의 소스 파일을 다운로드할 권한이 없습니다.",
      en: "You do not have permission to download source files for this tenant.",
      ja: "このテナントのソースファイルをダウンロードする権限がありません。",
      de: "Sie sind nicht berechtigt, Quelldateien für diesen Mandanten herunterzuladen.",
      fr: "Vous n’avez pas l’autorisation de télécharger les fichiers source de ce locataire.",
      it: "Non hai l'autorizzazione per scaricare i file sorgente di questo tenant.",
      zh: "您沒有下載此租戶來源檔案的權限。",
      es: "No tiene permiso para descargar archivos de origen de este inquilino."
    },
    SERVER_API_SECRET_FORBIDDEN: {
      ko: "Server API Secret을 관리할 권한이 없습니다.",
      en: "You do not have permission to manage Server API Secrets.",
      ja: "Server API Secretを管理する権限がありません。",
      de: "Sie sind nicht berechtigt, Server-API-Secrets zu verwalten.",
      fr: "Vous n’avez pas l’autorisation de gérer les Server API Secrets.",
      it: "Non hai l'autorizzazione per gestire i Server API Secret.",
      zh: "您沒有管理 Server API Secret 的權限。",
      es: "No tiene permiso para gestionar Server API Secrets."
    },
    SERVER_API_SECRET_LIMIT: {
      ko: "활성 Server API Secret은 테넌트당 최대 5개까지 만들 수 있습니다.",
      en: "You can create up to 5 active Server API Secrets per tenant.",
      ja: "有効な Server API Secret はテナントごとに最大5つまで作成できます。",
      de: "Pro Mandant können maximal 5 aktive Server-API-Secrets erstellt werden.",
      fr: "Vous pouvez créer jusqu’à 5 Server API Secrets actifs par locataire.",
      it: "Puoi creare fino a 5 Server API Secret attivi per tenant.",
      zh: "每個租戶最多可建立 5 個作用中的 Server API Secret。",
      es: "Puede crear hasta 5 Server API Secrets activos por inquilino."
    },
    SERVER_API_SECRET_NOT_FOUND: {
      ko: "Server API Secret을 찾을 수 없습니다.",
      en: "Server API Secret not found.",
      ja: "Server API Secret が見つかりません。",
      de: "Server-API-Secret wurde nicht gefunden.",
      fr: "Server API Secret introuvable.",
      it: "Server API Secret non trovato.",
      zh: "找不到 Server API Secret。",
      es: "No se encontró el Server API Secret."
    },
    BILLING_INVOICE_GENERATION_FAILED: {
      ko: "인보이스 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      en: "Failed to generate invoice. Please try again later.",
      ja: "請求書の生成に失敗しました。しばらくしてから再試行してください。",
      de: "Rechnung konnte nicht erstellt werden. Bitte später erneut versuchen.",
      fr: "Échec de la génération de la facture. Veuillez réessayer plus tard.",
      it: "Impossibile generare la fattura. Riprova più tardi.",
      zh: "產生發票失敗，請稍後再試。",
      es: "No se pudo generar la factura. Inténtelo de nuevo más tarde."
    },
    BILLING_DOWNGRADE_ONLY: {
      ko: "다운그레이드 예약만 가능합니다. 업그레이드는 구독 취소 후 새 플랜으로 다시 구독해 주세요.",
      en: "Only downgrades can be scheduled. For upgrades, cancel and re-subscribe to the new plan.",
      ja: "ダウングレードの予約のみ可能です。アップグレードは解約後に新しいプランで再購読してください。",
      de: "Es können nur Downgrades geplant werden. Für Upgrades bitte kündigen und neu abonnieren.",
      fr: "Seuls les downgrades peuvent être planifiés. Pour un upgrade, annulez puis réabonnez-vous.",
      it: "È possibile programmare solo downgrade. Per l'upgrade, annulla e riabbonati al nuovo piano.",
      zh: "只可預約降級。如需升級，請先取消訂閱，再重新訂閱新方案。",
      es: "Solo se pueden programar downgrades. Para upgrades, cancela y vuelve a suscribirte al nuevo plan."
    },
    BILLING_SAME_PLAN_NOT_ALLOWED: {
      ko: "현재 플랜과 동일한 플랜으로는 예약 변경할 수 없습니다.",
      en: "You can't schedule a change to the same plan.",
      ja: "同じプランへの変更は予約できません。",
      de: "Eine Änderung auf denselben Plan kann nicht geplant werden.",
      fr: "Vous ne pouvez pas planifier un changement vers le même plan.",
      it: "Non puoi programmare un cambio allo stesso piano.",
      zh: "不能預約變更為相同方案。",
      es: "No puedes programar un cambio al mismo plan."
    },
    BILLING_SCHEDULE_USE_UPGRADE_ENDPOINT: {
      ko: "플랜 등급 상향은 즉시 업그레이드 API를 사용해 주세요. 이 API는 갱신 시점 다운그레이드 등 예약 변경용입니다.",
      en: "For upgrading to a higher plan tier, use the immediate upgrade API. This endpoint is for scheduled changes at renewal (e.g. downgrades).",
      ja: "上位プランへのアップグレードは即時アップグレードAPIを使用してください。このAPIは更新時点でのダウングレードなどの予約変更用です。",
      de: "Für ein höheres Tarif-Level nutzen Sie die sofortige Upgrade-API. Dieser Endpunkt ist für Änderungen zum Verlängerungszeitpunkt (z. B. Downgrades).",
      fr: "Pour passer à un palier supérieur, utilisez l'API de mise à niveau immédiate. Ce point de terminaison sert aux changements planifiés au renouvellement (ex. rétrogradations).",
      it: "Per passare a un livello di piano superiore usa l'API di upgrade immediato. Questo endpoint è per modifiche programmate al rinnovo (es. downgrade).",
      zh: "若要升級到較高的方案等級，請使用立即升級 API。此端點用於在續訂時預約變更（例如降級）。",
      es: "Para subir de nivel de plan, usa la API de mejora inmediata. Este endpoint es para cambios programados al renovar (p. ej., degradaciones)."
    },
    BILLING_UPGRADE_NOT_ALLOWED: {
      ko: "업그레이드만 이 API로 처리할 수 있습니다. 더 낮은 플랜으로의 변경은 갱신 시점 예약 변경 API를 사용해 주세요.",
      en: "This endpoint only supports upgrades. For downgrades, use the schedule-at-renewal subscription change API.",
      ja: "このAPIはアップグレードのみ対応です。ダウングレードは更新タイミングの予約変更APIを使用してください。",
      de: "Dieser Endpunkt unterstützt nur Upgrades. Für Downgrades nutzen Sie die API für Änderungen zum Verlängerungszeitpunkt.",
      fr: "Ce point de terminaison ne prend en charge que les mises à niveau. Pour les rétrogradations, utilisez l'API de changement planifié au renouvellement.",
      it: "Questo endpoint supporta solo upgrade. Per i downgrade usa l'API di modifica programmata al rinnovo.",
      zh: "此端點僅支援升級。若要降級，請使用「在續訂時變更方案」的預約 API。",
      es: "Este endpoint solo admite mejoras. Para degradaciones, usa la API de cambio programado al renovar."
    },
    BILLING_RESUME_SUBSCRIPTION_MISMATCH: {
      ko: "요청한 구독 ID가 이 테넌트에 저장된 취소 예약과 일치하지 않습니다.",
      en: "The subscription ID does not match the scheduled cancellation on file for this tenant.",
      ja: "指定したサブスクリプションIDが、このテナントのキャンセル予約と一致しません。",
      de: "Die Abonnement-ID stimmt nicht mit der gespeicherten Kündigungsvormerkung für diesen Mandanten überein.",
      fr: "L'identifiant d'abonnement ne correspond pas à l'annulation programmée enregistrée pour ce locataire.",
      it: "L'ID abbonamento non corrisponde alla cancellazione programmata registrata per questo tenant.",
      zh: "訂閱 ID 與此租戶記錄的預約取消不相符。",
      es: "El ID de suscripción no coincide con la cancelación programada registrada para este inquilino."
    },
    // Dataset
    ANALYTICS_UNANSWERED_NOT_FOUND: {
      ko: "미답변 분석 기록을 찾을 수 없습니다.",
      en: "We couldn't find the unanswered analytics record.",
      ja: "未回答の分析記録が見つかりません。",
      de: "Der Analyse-Eintrag für unbeantwortete Fragen wurde nicht gefunden.",
      fr: "Enregistrement d'analyse des questions sans réponse introuvable.",
      it: "Record di analisi domande senza risposta non trovato.",
      zh: "找不到未回答問題的分析記錄。",
      es: "No se encontró el registro de análisis de preguntas sin respuesta."
    },
    INVALID_ANALYTICS_RECORD: {
      ko: "분석할 질문 정보가 없습니다.",
      en: "This analytics record has no question to analyze.",
      ja: "分析対象の質問がありません。",
      de: "Dieser Analyse-Eintrag enthält keine Frage.",
      fr: "Cet enregistrement ne contient aucune question à analyser.",
      it: "Questo record non contiene una domanda da analizzare.",
      zh: "此分析記錄沒有可分析的問題。",
      es: "Este registro no tiene una pregunta para analizar."
    },
    ANALYSIS_FAILED: {
      ko: "분석을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      en: "We couldn't complete the analysis. Please try again later.",
      ja: "分析を完了できませんでした。しばらくしてから再度お試しください。",
      de: "Die Analyse konnte nicht abgeschlossen werden. Bitte versuchen Sie es später erneut.",
      fr: "L'analyse n'a pas pu être terminée. Veuillez réessayer plus tard.",
      it: "Impossibile completare l'analisi. Riprova più tardi.",
      zh: "無法完成分析，請稍後再試。",
      es: "No se pudo completar el análisis. Inténtelo de nuevo más tarde."
    },
    DATASET_NOT_FOUND: {
      ko: "데이터셋을 찾을 수 없습니다.",
      en: "We couldn't find the data set.",
      ja: "データセットが見つかりません。",
      de: "Der Datensatz wurde nicht gefunden.",
      fr: "Jeu de données introuvable.",
      it: "Impossibile trovare il set di dati.",
      zh: "找不到資料集。",
      es: "No pudimos encontrar el conjunto de datos."
    },
    DATASET_ALREADY_DELETED: {
      ko: "이미 삭제된 데이터셋입니다.",
      en: "This data set has already been deleted.",
      ja: "データセットは既に削除されています。",
      de: "Dieser Datensatz wurde bereits gelöscht.",
      fr: "Le jeu de données a déjà été supprimé.",
      it: "Questo set di dati e gia stato eliminato.",
      zh: "資料集已被刪除。",
      es: "Este conjunto de datos ya fue eliminado."
    },
    // Google Sheets Sync
    SYNC_PARAMS_REQUIRED: {
      ko: "동기화에 필요한 정보가 누락되었습니다.",
      en: "Some information required for sync is missing.",
      ja: "同期に必要な情報が不足しています。",
      de: "Für die Synchronisierung fehlen erforderliche Informationen.",
      fr: "Des informations nécessaires à la synchronisation sont manquantes.",
      it: "Mancano alcune informazioni necessarie per la sincronizzazione.",
      zh: "缺少同步所需的資料。",
      es: "Falta información necesaria para la sincronización."
    },
    INVALID_ROWS_OR_COLS: {
      ko: "행 수 또는 열 수 정보가 올바르지 않습니다.",
      en: "The row or column information is invalid.",
      ja: "行数または列数の情報が正しくありません。",
      de: "Die Angaben zu Zeilen oder Spalten sind ungültig.",
      fr: "Les informations sur les lignes ou les colonnes ne sont pas valides.",
      it: "Le informazioni su righe o colonne non sono valide.",
      zh: "資料列或欄位資訊無效。",
      es: "La información sobre filas o columnas no es válida."
    },
    GOOGLE_OAUTH_NOT_CONFIGURED: {
      ko: "Google OAuth가 설정되지 않았습니다.",
      en: "Google OAuth is not configured.",
      ja: "Google OAuthが設定されていません。",
      de: "Google OAuth ist nicht konfiguriert.",
      fr: "Google OAuth n'est pas configuré.",
      it: "Google OAuth non è configurato.",
      zh: "尚未設定 Google OAuth。",
      es: "Google OAuth no está configurado."
    },
    INVALID_SOURCE_TYPE: {
      ko: "이 데이터셋은 Google 시트 소스가 아닙니다.",
      en: "This data set is not connected to Google Sheets.",
      ja: "このデータセットは Google スプレッドシートに接続されていません。",
      de: "Dieser Datensatz ist nicht mit Google Sheets verbunden.",
      fr: "Ce jeu de données n’est pas connecté à Google Sheets.",
      it: "Questo set di dati non è collegato a Google Sheets.",
      zh: "此資料集不是 Google Sheets 來源。",
      es: "Este conjunto de datos no está conectado a Google Sheets."
    },
    MISSING_SHEET_INFO: {
      ko: "Google 시트 연결 정보가 누락되었습니다.",
      en: "The Google Sheets connection information is missing.",
      ja: "Google スプレッドシートの接続情報が不足しています。",
      de: "Die Verbindungsinformationen zu Google Sheets fehlen.",
      fr: "Les informations de connexion à Google Sheets sont manquantes.",
      it: "Mancano le informazioni di collegamento a Google Sheets.",
      zh: "缺少 Google Sheets 連線資料。",
      es: "Falta la información de conexión con Google Sheets."
    },
    MISSING_REFRESH_TOKEN: {
      ko: "Google 시트 연결이 만료되었습니다. 다시 연결해 주세요.",
      en: "Your Google Sheets connection has expired. Please reconnect it.",
      ja: "Google スプレッドシートとの接続期限が切れています。再接続してください。",
      de: "Die Verbindung zu Google Sheets ist abgelaufen. Bitte verbinden Sie sie erneut.",
      fr: "Votre connexion à Google Sheets a expiré. Veuillez la reconnecter.",
      it: "La connessione a Google Sheets è scaduta. Ricollegala.",
      zh: "Google Sheets 連線已過期，請重新連接。",
      es: "La conexión con Google Sheets ha caducado. Vuelve a conectarla."
    },
    DECRYPT_FAILED: {
      ko: "Google 시트 연결 정보를 확인할 수 없습니다. 다시 연결해 주세요.",
      en: "We couldn't verify your Google Sheets connection. Please reconnect it.",
      ja: "Google スプレッドシートとの接続情報を確認できませんでした。再接続してください。",
      de: "Die Verbindung zu Google Sheets konnte nicht verifiziert werden. Bitte verbinden Sie sie erneut.",
      fr: "Nous n’avons pas pu vérifier votre connexion à Google Sheets. Veuillez la reconnecter.",
      it: "Non siamo riusciti a verificare la connessione a Google Sheets. Ricollegala.",
      zh: "無法驗證 Google Sheets 連線，請重新連接。",
      es: "No pudimos verificar la conexión con Google Sheets. Vuelve a conectarla."
    },
    GOOGLE_OAUTH_NO_ACCESS_TOKEN: {
      ko: "Google 인증을 완료하지 못했습니다. 다시 시도해 주세요.",
      en: "We couldn't complete Google authentication. Please try again.",
      ja: "Google 認証を完了できませんでした。もう一度お試しください。",
      de: "Die Google-Authentifizierung konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut.",
      fr: "Nous n’avons pas pu finaliser l’authentification Google. Veuillez réessayer.",
      it: "Non siamo riusciti a completare l'autenticazione Google. Riprova.",
      zh: "未能完成 Google 驗證，請再試一次。",
      es: "No pudimos completar la autenticación de Google. Inténtalo de nuevo."
    },
    GOOGLE_SHEETS_NO_SHEETS: {
      ko: "스프레드시트에 시트가 없습니다.",
      en: "No sheets in spreadsheet.",
      ja: "スプレッドシートにシートがありません。",
      de: "Keine Blätter in der Tabelle.",
      fr: "Aucune feuille dans le tableur.",
      it: "Nessun foglio nel foglio di calcolo.",
      zh: "試算表中沒有任何工作表。",
      es: "No hay hojas en la hoja de cálculo."
    },
    GOOGLE_SHEETS_SPREADSHEET_FAILED: {
      ko: "스프레드시트를 가져오지 못했습니다.",
      en: "Failed to get spreadsheet.",
      ja: "スプレッドシートの取得に失敗しました。",
      de: "Tabelle konnte nicht abgerufen werden.",
      fr: "Échec de la récupération du tableur.",
      it: "Impossibile recuperare il foglio di calcolo.",
      zh: "取得試算表失敗。",
      es: "Error al obtener la hoja de cálculo."
    },
    GOOGLE_SHEETS_VALUES_FAILED: {
      ko: "시트 값을 가져오지 못했습니다.",
      en: "Failed to get sheet values.",
      ja: "シートの値を取得に失敗しました。",
      de: "Tabellenwerte konnten nicht abgerufen werden.",
      fr: "Échec de la récupération des valeurs de la feuille.",
      it: "Impossibile recuperare i valori del foglio.",
      zh: "取得工作表內容失敗。",
      es: "Error al obtener los valores de la hoja."
    },
    TOO_MANY_ROWS_MAX: {
      ko: "행 수 제한을 초과했습니다. (최대 {max}행)",
      en: "Row limit exceeded (max {max}).",
      ja: "行数制限を超えました。（最大{max}行）",
      de: "Zeilenlimit überschritten (max. {max}).",
      fr: "Limite de lignes dépassée (max. {max}).",
      it: "Limite righe superato (max {max}).",
      zh: "已超出資料列上限（最多 {max} 列）。",
      es: "Límite de filas excedido (máx. {max})."
    },
    TEXT_TOO_LONG_MAX: {
      ko: "행 텍스트가 {max}자를 초과합니다.",
      en: "Row text exceeds {max} characters.",
      ja: "行テキストが{max}文字を超えています。",
      de: "Zeilentext überschreitet {max} Zeichen.",
      fr: "Le texte de la ligne dépasse {max} caractères.",
      it: "Il testo della riga supera {max} caratteri.",
      zh: "資料列文字超過 {max} 個字元。",
      es: "El texto de la fila supera {max} caracteres."
    },
    SYNC_NO_CHANGES: {
      ko: "변경 사항이 없습니다.",
      en: "No changes detected.",
      ja: "変更は検出されませんでした。",
      de: "Keine Änderungen erkannt.",
      fr: "Aucun changement détecté.",
      it: "Nessuna modifica rilevata.",
      zh: "未偵測到任何變更。",
      es: "No se detectaron cambios."
    },
    EMAIL_LOGIN_INVALID_PURPOSE: {
      ko: "지원하지 않는 로그인 용도입니다.",
      en: "Unsupported login purpose.",
      ja: "サポートされていないログイン用途です。",
      de: "Nicht unterstützter Anmeldezweck.",
      fr: "Usage de connexion non pris en charge.",
      it: "Scopo di accesso non supportato.",
      zh: "不支援的登入用途。",
      es: "Propósito de inicio de sesión no compatible."
    },
    EMAIL_LOGIN_INVALID_EMAIL: {
      ko: "유효한 이메일을 입력하세요.",
      en: "Please enter a valid email address.",
      ja: "有効なメールアドレスを入力してください。",
      de: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      fr: "Veuillez saisir une adresse e-mail valide.",
      it: "Inserisci un indirizzo email valido.",
      zh: "請輸入有效的電子郵件地址。",
      es: "Introduce una dirección de correo válida."
    },
    EMAIL_LOGIN_FORBIDDEN: {
      ko: "이 이메일로는 로그인할 수 없습니다.",
      en: "You cannot sign in with this email.",
      ja: "このメールアドレスではログインできません。",
      de: "Mit dieser E-Mail-Adresse können Sie sich nicht anmelden.",
      fr: "Vous ne pouvez pas vous connecter avec cet e-mail.",
      it: "Non puoi accedere con questa email.",
      zh: "無法使用此電子郵件登入。",
      es: "No puedes iniciar sesión con este correo."
    },
    EMAIL_LOGIN_RATE_LIMITED: {
      ko: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
      en: "Too many requests. Please try again later.",
      ja: "リクエストが多すぎます。しばらくしてから再度お試しください。",
      de: "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
      fr: "Trop de demandes. Veuillez réessayer plus tard.",
      it: "Troppe richieste. Riprova più tardi.",
      zh: "請求過於頻繁，請稍後再試。",
      es: "Demasiadas solicitudes. Inténtalo de nuevo más tarde."
    },
    EMAIL_LOGIN_EMAIL_SEND_FAILED: {
      ko: "인증 코드 메일을 보내지 못했습니다.",
      en: "Failed to send the verification code email.",
      ja: "認証コードメールを送信できませんでした。",
      de: "Die E-Mail mit dem Bestätigungscode konnte nicht gesendet werden.",
      fr: "Impossible d'envoyer l'e-mail de code de vérification.",
      it: "Impossibile inviare l'email con il codice di verifica.",
      zh: "無法傳送驗證碼郵件。",
      es: "No se pudo enviar el correo con el código de verificación."
    },
    EMAIL_LOGIN_INVALID_CODE_FORMAT: {
      ko: "{digits}자리 인증 코드를 입력하세요.",
      en: "Enter a {digits}-digit verification code.",
      ja: "{digits}桁の認証コードを入力してください。",
      de: "Geben Sie einen {digits}-stelligen Bestätigungscode ein.",
      fr: "Saisissez un code de vérification à {digits} chiffres.",
      it: "Inserisci un codice di verifica di {digits} cifre.",
      zh: "請輸入 {digits} 位驗證碼。",
      es: "Introduce un código de verificación de {digits} dígitos."
    },
    EMAIL_LOGIN_OTP_EXPIRED: {
      ko: "인증 코드가 만료되었습니다. 다시 요청하세요.",
      en: "The verification code has expired. Please request a new one.",
      ja: "認証コードの有効期限が切れました。再度リクエストしてください。",
      de: "Der Bestätigungscode ist abgelaufen. Bitte fordern Sie einen neuen an.",
      fr: "Le code de vérification a expiré. Veuillez en demander un nouveau.",
      it: "Il codice di verifica è scaduto. Richiedine uno nuovo.",
      zh: "驗證碼已過期，請重新申請。",
      es: "El código de verificación ha caducado. Solicita uno nuevo."
    },
    EMAIL_LOGIN_OTP_LOCKED: {
      ko: "시도 횟수를 초과했습니다. 코드를 다시 요청하세요.",
      en: "Too many attempts. Please request a new code.",
      ja: "試行回数の上限を超えました。コードを再度リクエストしてください。",
      de: "Zu viele Versuche. Bitte fordern Sie einen neuen Code an.",
      fr: "Trop de tentatives. Veuillez demander un nouveau code.",
      it: "Troppi tentativi. Richiedi un nuovo codice.",
      zh: "嘗試次數過多，請重新申請驗證碼。",
      es: "Demasiados intentos. Solicita un código nuevo."
    },
    EMAIL_LOGIN_OTP_INVALID: {
      ko: "인증 코드가 올바르지 않습니다.",
      en: "The verification code is incorrect.",
      ja: "認証コードが正しくありません。",
      de: "Der Bestätigungscode ist falsch.",
      fr: "Le code de vérification est incorrect.",
      it: "Il codice di verifica non è corretto.",
      zh: "驗證碼不正確。",
      es: "El código de verificación es incorrecto."
    },
    EMAIL_LOGIN_OTP_NOT_FOUND: {
      ko: "인증 코드가 올바르지 않거나 만료되었습니다.",
      en: "The verification code is invalid or has expired.",
      ja: "認証コードが無効か、有効期限が切れています。",
      de: "Der Bestätigungscode ist ungültig oder abgelaufen.",
      fr: "Le code de vérification est invalide ou a expiré.",
      it: "Il codice di verifica non è valido o è scaduto.",
      zh: "驗證碼無效或已過期。",
      es: "El código de verificación no es válido o ha caducado."
    },
    EMAIL_LOGIN_AUTH_USER_NOT_FOUND: {
      ko: "Firebase Auth에 해당 계정이 없습니다.",
      en: "No account was found for this email.",
      ja: "このメールアドレスのアカウントが見つかりません。",
      de: "Für diese E-Mail wurde kein Konto gefunden.",
      fr: "Aucun compte trouvé pour cet e-mail.",
      it: "Nessun account trovato per questa email.",
      zh: "找不到此電子郵件對應的帳戶。",
      es: "No se encontró una cuenta para este correo."
    },
    ISSUE_TRACK_RATE_LIMITED: {
      ko: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
      en: "Too many requests. Please try again in a moment.",
      ja: "リクエストが多すぎます。しばらくしてからもう一度お試しください。",
      de: "Zu viele Anfragen. Bitte versuchen Sie es gleich noch einmal.",
      fr: "Trop de demandes. Réessayez dans un instant.",
      it: "Troppe richieste. Riprova tra un momento.",
      zh: "請求太頻繁了，請稍後再試。",
      es: "Demasiadas solicitudes. Inténtalo de nuevo en un momento."
    },
    ISSUE_TRACK_INVALID_REQUEST: {
      ko: "요청 정보가 부족합니다. 다시 시도해 주세요.",
      en: "Something is missing from this request. Please try again.",
      ja: "必要な情報が足りません。もう一度お試しください。",
      de: "Für diese Anfrage fehlen Angaben. Bitte versuchen Sie es erneut.",
      fr: "Il manque des informations pour cette demande. Veuillez réessayer.",
      it: "Mancano alcune informazioni. Riprova.",
      zh: "這次請求缺少必要資訊，請再試一次。",
      es: "Falta información en esta solicitud. Inténtalo de nuevo."
    },
    ISSUE_TRACK_GATEWAY_FORBIDDEN: {
      ko: "이 경로에서는 문의 접수를 사용할 수 없습니다.",
      en: "Leaving a request is not available through this connection.",
      ja: "この接続では問い合わせを受け付けできません。",
      de: "Über diese Verbindung können keine Anfragen hinterlassen werden.",
      fr: "Laisser une demande n'est pas disponible via cette connexion.",
      it: "Non è possibile lasciare una richiesta tramite questa connessione.",
      zh: "無法透過此連線留下詢問。",
      es: "No se puede dejar una consulta a través de esta conexión."
    },
    ISSUE_TRACK_DISABLED: {
      ko: "이 채널에서는 이슈 트랙을 사용하지 않습니다.",
      en: "Issue Track is turned off for this channel.",
      ja: "このチャネルではイシュートラックがオフです。",
      de: "Issue Track ist für diesen Kanal ausgeschaltet.",
      fr: "Issue Track est désactivé pour ce canal.",
      it: "Issue Track è disattivato per questo canale.",
      zh: "此頻道尚未開啟工單追蹤。",
      es: "Issue Track está desactivado en este canal."
    },
    ISSUE_TRACK_INVALID_EMAIL: {
      ko: "연락받을 이메일을 올바르게 입력해 주세요.",
      en: "Please enter a valid email address.",
      ja: "正しいメールアドレスを入力してください。",
      de: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      fr: "Veuillez saisir une adresse e-mail valide.",
      it: "Inserisci un'email valida.",
      zh: "請輸入有效的電子郵件。",
      es: "Introduce un correo válido."
    },
    ISSUE_TRACK_NOT_FOUND: {
      ko: "문의를 찾을 수 없습니다.",
      en: "We couldn't find that inquiry.",
      ja: "問い合わせが見つかりません。",
      de: "Diese Anfrage wurde nicht gefunden.",
      fr: "Cette demande est introuvable.",
      it: "Richiesta non trovata.",
      zh: "找不到這筆詢問。",
      es: "No encontramos esa consulta."
    },
    ISSUE_TRACK_INVALID_STATUS: {
      ko: "선택할 수 없는 상태입니다.",
      en: "That status isn't available.",
      ja: "その状態は選べません。",
      de: "Dieser Status ist nicht verfügbar.",
      fr: "Ce statut n'est pas disponible.",
      it: "Questo stato non è disponibile.",
      zh: "無法使用這個狀態。",
      es: "Ese estado no está disponible."
    },
    ISSUE_TRACK_REPLY_REQUIRED: {
      ko: "제목과 내용을 입력해 주세요.",
      en: "Please enter a subject and message.",
      ja: "件名と本文を入力してください。",
      de: "Bitte Betreff und Nachricht eingeben.",
      fr: "Saisissez un objet et un message.",
      it: "Inserisci oggetto e messaggio.",
      zh: "請輸入主旨與內容。",
      es: "Escribe un asunto y un mensaje."
    },
    ISSUE_TRACK_NO_CONTACT_EMAIL: {
      ko: "이 문의에는 연락할 이메일이 없습니다.",
      en: "This inquiry has no email address to reply to.",
      ja: "この問い合わせには返信先メールがありません。",
      de: "Für diese Anfrage ist keine Antwort-E-Mail hinterlegt.",
      fr: "Cette demande n'a pas d'adresse e-mail pour la réponse.",
      it: "Questa richiesta non ha un'email a cui rispondere.",
      zh: "這筆詢問沒有可回覆的電子郵件。",
      es: "Esta consulta no tiene un correo al que responder."
    },
    ISSUE_TRACK_REPLY_SEND_FAILED: {
      ko: "회신 메일을 보내지 못했습니다.",
      en: "We couldn't send the reply email.",
      ja: "返信メールを送れませんでした。",
      de: "Die Antwort-E-Mail konnte nicht gesendet werden.",
      fr: "Impossible d'envoyer l'e-mail de réponse.",
      it: "Non siamo riusciti a inviare l'email di risposta.",
      zh: "無法寄出回覆郵件。",
      es: "No pudimos enviar el correo de respuesta."
    },
    ISSUE_TRACK_LIST_FAILED: {
      ko: "문의 목록을 불러오지 못했습니다.",
      en: "We couldn't load the inquiry list.",
      ja: "問い合わせ一覧を読み込めませんでした。",
      de: "Die Anfrageliste konnte nicht geladen werden.",
      fr: "Impossible de charger la liste des demandes.",
      it: "Impossibile caricare l'elenco delle richieste.",
      zh: "無法載入詢問列表。",
      es: "No pudimos cargar la lista de consultas."
    }
  };

  const messageMap = messages[errorType];
  if (!messageMap) {
    // 정의되지 않은 에러 타입인 경우 영어 기본 메시지 반환
    return `An error occurred: ${errorType || "Unknown error"}.`;
  }
  return messageMap[lang] || messageMap.en;
}

// locale 기반 상태 메시지 반환
function getLocalizedStatusMessage(locale, statusKey) {
  const lang = detectLanguageFromLocale(locale);

  const statusMessages = {
    loading_data: {
      ko: "데이터를 불러오고 있습니다...",
      en: "Loading data...",
      ja: "データを読み込み中...",
      de: "Daten werden geladen...",
      fr: "Chargement des données...",
      it: "Caricamento dati...",
      zh: "正在載入資料...",
      es: "Cargando datos..."
    },
    loading_tenant: {
      ko: "정보를 확인하고 있습니다...",
      en: "Checking information...",
      ja: "情報を確認中...",
      de: "Informationen werden überprüft...",
      fr: "Vérification des informations...",
      it: "Verifica delle informazioni...",
      zh: "正在檢查資料...",
      es: "Verificando información..."
    },
    vector_search: {
      ko: "검색 중...",
      en: "Searching...",
      ja: "検索中...",
      de: "Suche läuft...",
      fr: "Recherche en cours...",
      it: "Ricerca in corso...",
      zh: "正在搜尋...",
      es: "Buscando..."
    },
    analyzing_question: {
      ko: "질문을 이해하고 있습니다...",
      en: "Understanding your question...",
      ja: "質問を理解しています...",
      de: "Ihre Frage wird verstanden...",
      fr: "Compréhension de votre question...",
      it: "Comprensione della tua domanda...",
      zh: "正在理解你的問題...",
      es: "Comprendiendo su pregunta..."
    },
    optimizing_search: {
      ko: "검색을 준비하고 있습니다...",
      en: "Preparing search...",
      ja: "検索を準備しています...",
      de: "Suche wird vorbereitet...",
      fr: "Préparation de la recherche...",
      it: "Preparazione della ricerca...",
      zh: "正在準備搜尋...",
      es: "Preparando búsqueda..."
    },
    searching_again: {
      ko: "관련 정보를 찾고 있습니다...",
      en: "Looking for related information...",
      ja: "関連情報を探しています...",
      de: "Suche nach relevanten Informationen...",
      fr: "Recherche d'informations connexes...",
      it: "Ricerca di informazioni correlate...",
      zh: "正在尋找相關資料...",
      es: "Buscando información relacionada..."
    },
    loading_sources: {
      ko: "참고 자료를 불러오고 있습니다...",
      en: "Loading reference materials...",
      ja: "参考資料を読み込み中...",
      de: "Referenzmaterialien werden geladen...",
      fr: "Chargement des documents de référence...",
      it: "Caricamento materiali di riferimento...",
      zh: "正在載入參考資料...",
      es: "Cargando materiales de referencia..."
    },
    searching_additional: {
      ko: "더 많은 정보를 찾고 있습니다...",
      en: "Looking for more information...",
      ja: "より多くの情報を探しています...",
      de: "Suche nach weiteren Informationen...",
      fr: "Recherche de plus d'informations...",
      it: "Ricerca di ulteriori informazioni...",
      zh: "正在尋找更多資料...",
      es: "Buscando más información..."
    },
    loading_expanded_sources: {
      ko: "참고 자료를 불러오고 있습니다...",
      en: "Loading reference materials...",
      ja: "参考資料を読み込み中...",
      de: "Referenzmaterialien werden geladen...",
      fr: "Chargement des documents de référence...",
      it: "Caricamento materiali di riferimento...",
      zh: "正在載入參考資料...",
      es: "Cargando materiales de referencia..."
    },
    calling_model: {
      ko: "답변을 준비하고 있습니다...",
      en: "Preparing response...",
      ja: "回答を準備しています...",
      de: "Antwort wird vorbereitet...",
      fr: "Préparation de la réponse...",
      it: "Preparazione della risposta...",
      zh: "正在準備回覆...",
      es: "Preparando respuesta..."
    },
    generating_response: {
      ko: "답변을 작성하고 있습니다...",
      en: "Writing response...",
      ja: "回答を作成しています...",
      de: "Antwort wird geschrieben...",
      fr: "Rédaction de la réponse...",
      it: "Scrittura della risposta...",
      zh: "正在撰寫回覆...",
      es: "Escribiendo respuesta..."
    },
    processing: {
      ko: "처리 중...",
      en: "Processing...",
      ja: "処理中...",
      de: "Wird verarbeitet...",
      fr: "Traitement en cours...",
      it: "Elaborazione in corso...",
      zh: "正在處理...",
      es: "Procesando..."
    },
    selecting_evidence: {
      ko: "관련 자료를 선별하고 있습니다...",
      en: "Selecting relevant sources...",
      ja: "関連資料を選別しています...",
      de: "Relevante Quellen werden ausgewählt...",
      fr: "Sélection des sources pertinentes...",
      it: "Selezione delle fonti pertinenti...",
      zh: "正在篩選相關資料...",
      es: "Seleccionando fuentes relevantes..."
    },
    composing_answer: {
      ko: "검색 결과에서 답을 정리하고 있습니다...",
      en: "Composing an answer from search results...",
      ja: "検索結果から回答を整理しています...",
      de: "Antwort aus Suchergebnissen wird erstellt...",
      fr: "Composition de la réponse à partir des résultats...",
      it: "Composizione della risposta dai risultati...",
      zh: "正在整理搜尋結果以形成回覆...",
      es: "Componiendo la respuesta a partir de los resultados..."
    },
    verifying_answer: {
      ko: "원문과 답변이 일치하는지 확인하고 있습니다...",
      en: "Verifying the answer against sources...",
      ja: "原文と回答の一致を確認しています...",
      de: "Antwort wird anhand der Quellen überprüft...",
      fr: "Vérification de la réponse par rapport aux sources...",
      it: "Verifica della risposta rispetto alle fonti...",
      zh: "正在核對回覆與原文是否一致...",
      es: "Verificando la respuesta con las fuentes..."
    },
    building_table: {
      ko: "표 형식으로 정리하고 있습니다...",
      en: "Formatting as a table...",
      ja: "表形式に整理しています...",
      de: "Antwort wird als Tabelle formatiert...",
      fr: "Mise en forme sous forme de tableau...",
      it: "Formattazione in tabella...",
      zh: "正在整理成表格格式...",
      es: "Formateando como tabla..."
    },
    scanning_records: {
      ko: "전체 데이터를 확인하고 있습니다...",
      en: "Scanning all records...",
      ja: "全データを確認しています...",
      de: "Alle Datensätze werden geprüft...",
      fr: "Analyse de l'ensemble des données...",
      it: "Scansione di tutti i record...",
      zh: "正在檢查全部資料...",
      es: "Revisando todos los registros..."
    },
    reranking_results: {
      ko: "검색 결과 순위를 조정하고 있습니다...",
      en: "Re-ranking search results...",
      ja: "検索結果の順位を調整しています...",
      de: "Suchergebnisse werden neu sortiert...",
      fr: "Réorganisation des résultats de recherche...",
      it: "Riordino dei risultati di ricerca...",
      zh: "正在調整搜尋結果排序...",
      es: "Reordenando resultados de búsqueda..."
    }
  };

  const messageMap = statusMessages[statusKey];
  return messageMap ? messageMap[lang] || messageMap.en : statusKey;
}

// 언어 감지 및 메시지 반환
function detectLanguageAndGetNoResultMessage(locale) {
  if (locale) {
    const localeLower = locale.toLowerCase();
    if (localeLower.startsWith("ko") || localeLower.includes("korean")) {
      return "결과가 없어 답변이 어렵습니다.";
    } else if (
      localeLower.startsWith("en") ||
      localeLower.includes("english")
    ) {
      return "I'm sorry, but I couldn't find relevant information to answer your question.";
    } else if (
      localeLower.startsWith("ja") ||
      localeLower.includes("japanese")
    ) {
      return "申し訳ございませんが、ご質問にお答えするための関連情報が見つかりませんでした。";
    } else if (localeLower.startsWith("de") || localeLower.includes("german")) {
      return "Es tut mir leid, aber ich konnte keine relevanten Informationen finden, um Ihre Frage zu beantworten.";
    } else if (localeLower.startsWith("fr") || localeLower.includes("french")) {
      return "Je suis désolé, mais je n'ai pas pu trouver d'informations pertinentes pour répondre à votre question.";
    } else if (
      localeLower.startsWith("it") ||
      localeLower.includes("italian")
    ) {
      return "Mi dispiace, ma non sono riuscito a trovare informazioni pertinenti per rispondere alla tua domanda.";
    } else if (
      localeLower.startsWith("zh") ||
      localeLower.includes("chinese")
    ) {
      return "抱歉，我找不到足夠的相關資料來回答你的問題。";
    } else if (
      localeLower.startsWith("es") ||
      localeLower.includes("spanish")
    ) {
      return "Lo siento, no pude encontrar información relevante para responder a su pregunta.";
    }
    // locale이 있지만 지원하지 않는 언어면 영어로 fallback
    return "I'm sorry, but I couldn't find relevant information to answer your question.";
  }

  // 기본값: 영어
  return "I'm sorry, but I couldn't find relevant information to answer your question.";
}

// 등록된 데이터셋이 없거나 전부 deleted일 때 사용자 메시지
function getNoDatasetsMessage(locale) {
  if (locale) {
    const localeLower = locale.toLowerCase();
    if (localeLower.startsWith("ko") || localeLower.includes("korean")) {
      return "등록된 데이터셋이 없거나 모두 삭제된 상태입니다. 데이터셋을 등록한 후 다시 시도해 주세요.";
    } else if (
      localeLower.startsWith("en") ||
      localeLower.includes("english")
    ) {
      return "No datasets are registered or all datasets have been deleted. Please register a dataset and try again.";
    } else if (
      localeLower.startsWith("ja") ||
      localeLower.includes("japanese")
    ) {
      return "登録されたデータセットがありません。またはすべて削除されています。データセットを登録してから再度お試しください。";
    } else if (localeLower.startsWith("de") || localeLower.includes("german")) {
      return "Es sind keine Datensätze registriert oder alle wurden gelöscht. Bitte registrieren Sie einen Datensatz und versuchen Sie es erneut.";
    } else if (localeLower.startsWith("fr") || localeLower.includes("french")) {
      return "Aucun jeu de données n'est enregistré ou tous ont été supprimés. Veuillez enregistrer un jeu de données et réessayer.";
    } else if (
      localeLower.startsWith("it") ||
      localeLower.includes("italian")
    ) {
      return "Nessun set di dati registrato o tutti sono stati eliminati. Registra un set di dati e riprova.";
    } else if (
      localeLower.startsWith("zh") ||
      localeLower.includes("chinese")
    ) {
      return "目前沒有已登記的資料集，或資料集已全部刪除。請先建立資料集後再試。";
    } else if (
      localeLower.startsWith("es") ||
      localeLower.includes("spanish")
    ) {
      return "No hay conjuntos de datos registrados o todos han sido eliminados. Registre un conjunto de datos e inténtelo de nuevo.";
    }
    return "No datasets are registered or all datasets have been deleted. Please register a dataset and try again.";
  }
  return "No datasets are registered or all datasets have been deleted. Please register a dataset and try again.";
}

// locale 기반 thinking 메시지 반환
function getLocalizedThinkingMessage(locale, thinkingKey) {
  const lang = detectLanguageFromLocale(locale);

  const thinkingMessages = {
    checking_info: {
      ko: "정보를 확인하고 있습니다...",
      en: "Checking information...",
      ja: "情報を確認中...",
      de: "Informationen werden überprüft...",
      fr: "Vérification des informations...",
      it: "Verifica delle informazioni...",
      zh: "正在檢查資料...",
      es: "Verificando información..."
    },
    loading_data: {
      ko: "데이터를 불러오고 있습니다...",
      en: "Loading data...",
      ja: "データを読み込み中...",
      de: "Daten werden geladen...",
      fr: "Chargement des données...",
      it: "Caricamento dati...",
      zh: "正在載入資料...",
      es: "Cargando datos..."
    },
    converting_to_vector: {
      ko: "검색을 준비하고 있습니다...",
      en: "Preparing search...",
      ja: "検索を準備しています...",
      de: "Suche wird vorbereitet...",
      fr: "Préparation de la recherche...",
      it: "Preparazione della ricerca...",
      zh: "正在準備搜尋...",
      es: "Preparando búsqueda..."
    },
    searching_info: {
      ko: "관련 정보를 찾고 있습니다...",
      en: "Looking for relevant information...",
      ja: "関連情報を探しています...",
      de: "Suche nach relevanten Informationen...",
      fr: "Recherche d'informations pertinentes...",
      it: "Ricerca di informazioni pertinenti...",
      zh: "正在尋找相關資料...",
      es: "Buscando información relevante..."
    },
    loading_sources: {
      ko: "참고 자료를 불러오고 있습니다...",
      en: "Loading reference materials...",
      ja: "参考資料を読み込み中...",
      de: "Referenzmaterialien werden geladen...",
      fr: "Chargement des documents de référence...",
      it: "Caricamento materiali di riferimento...",
      zh: "正在載入參考資料...",
      es: "Cargando materiales de referencia..."
    },
    searching_additional: {
      ko: "더 많은 정보를 찾고 있습니다...",
      en: "Looking for more information...",
      ja: "より多くの情報を探しています...",
      de: "Suche nach weiteren Informationen...",
      fr: "Recherche de plus d'informations...",
      it: "Ricerca di ulteriori informazioni...",
      zh: "正在尋找更多資料...",
      es: "Buscando más información..."
    },
    loading_expanded_sources: {
      ko: "참고 자료를 불러오고 있습니다...",
      en: "Loading reference materials...",
      ja: "参考資料を読み込み中...",
      de: "Referenzmaterialien werden geladen...",
      fr: "Chargement des documents de référence...",
      it: "Caricamento materiali di riferimento...",
      zh: "正在載入參考資料...",
      es: "Cargando materiales de referencia..."
    },
    processing: {
      ko: "처리 중...",
      en: "Processing...",
      ja: "処理中...",
      de: "Wird verarbeitet...",
      fr: "Traitement en cours...",
      it: "Elaborazione in corso...",
      zh: "正在處理...",
      es: "Procesando..."
    }
  };

  const messageMap = thinkingMessages[thinkingKey];
  if (messageMap) return messageMap[lang] || messageMap.en;
  const processingMap = thinkingMessages["processing"];
  return processingMap ? processingMap[lang] || processingMap.en : thinkingKey;
}

/** 체크아웃 description에서 줄바꿈을 HTML <br>로 변환 (결제 페이지가 HTML 렌더 시 줄바꿈 표시용) */
function descriptionLineBreaks(description) {
  if (typeof description !== "string") return description;
  return description.replace(/\n/g, "<br>");
}

/**
 * 체크아웃용 상품명·설명 (이미지 기준 플랜별 다국어).
 *
 * - title/description은 checkout 화면에서 바로 보이므로, 너무 딱딱한 문장보다는
 *   짧고 핵심적인 문장 + 기능 요약(줄바꿈/불릿)을 권장합니다.
 * - variant 정보는 `utils/lemonsqueezy.getVariantInfo()` 반환값을 사용합니다.
 * - description은 줄바꿈(\n)을 <br>로 변환해 전달해 체크아웃 화면에서 줄바꿈이 보이도록 합니다.
 *
 * @param {string} locale - locale 문자열
 * @param {Object} variant - getVariantInfo 반환값 { kind, plan?, interval?, pack?, tokens? }
 * @returns {{ name: string, description: string }}
 */
function getBillingCheckoutProductOptions(locale, variant) {
  const lang = detectLanguageFromLocale(locale);
  const t = (map) => map[lang] || map.en;

  const intervalLabel = (interval) =>
    interval === "year"
      ? t({
          ko: "연간",
          en: "Yearly",
          ja: "年額",
          de: "Jährlich",
          fr: "Annuel",
          it: "Annuale",
          zh: "年繳",
          es: "Anual",
        })
      : t({
          ko: "월간",
          en: "Monthly",
          ja: "月額",
          de: "Monatlich",
          fr: "Mensuel",
          it: "Mensile",
          zh: "月繳",
          es: "Mensual",
        });

  const planName = (plan, interval) => {
    const label = intervalLabel(interval);
    const base = plan === "PRO" ? "Pro" : plan === "ENTERPRISE" ? "Enterprise" : "Starter";
    return t({
      ko: `${base} ${label} 플랜`,
      en: `${base} Plan (${label})`,
      ja: `${base}（${label}プラン）`,
      de: `${base} (${label}er Plan)`,
      fr: `${base} (${label})`,
      it: `${base} (${label})`,
      zh: `${base}（${label}計劃）`,
      es: `${base} (Plan ${label.toLowerCase()})`,
    });
  };

  const subscriptionDescription = (plan) => {
    const COMMON_STARTER = t({
      ko: "• Excel/CSV 업로드\n• Google Sheets 연동\n• 기본 API 및 위젯 제공\n• 기본 로그/통계",
      en: "• Excel/CSV upload\n• Google Sheets integration\n• Basic API & widget\n• Basic logs & stats",
      ja: "• Excel/CSVアップロード\n• Google Sheets連携\n• 基本API/ウィジェット\n• 基本ログ/統計",
      de: "• Excel/CSV-Upload\n• Google Sheets-Integration\n• Basic API & Widget\n• Basis-Logs/Statistiken",
      fr: "• Import Excel/CSV\n• Intégration Google Sheets\n• API & widget de base\n• Logs/statistiques de base",
      it: "• Upload Excel/CSV\n• Integrazione Google Sheets\n• API & widget base\n• Log/statistiche base",
      zh: "• 上傳 Excel/CSV\n• 整合 Google Sheets\n• 提供基本 API 與小工具\n• 基本日誌與統計",
      es: "• Carga Excel/CSV\n• Integración Google Sheets\n• API y widget básicos\n• Logs/estadísticas básicas",
    });

    if (plan === "PRO") {
      return t({
        ko: "성장 중인 팀을 위한 추천 플랜입니다.\n• Starter 포함 + 100M tokens/월\n• 소스 데이터셋 최대 10개 · 데이터셋당 최대 10,000 레코드\n• Google Sheets 자동 동기화(최대 1시간 간격)\n• Full API · 상세 로그/통계 · 정책 버전 관리",
        en: "Recommended for growing teams.\n• Everything in Starter + 100M tokens/month\n• Up to 10 source datasets · Up to 10,000 records per dataset\n• Google Sheets auto-sync (up to 1-hour interval)\n• Full API · Detailed logs/stats · Policy version control",
        ja: "成長中のチームにおすすめです。\n• Starterの全機能 + 月100Mトークン\n• ソースデータセット最大10件・各最大10,000レコード\n• Google Sheets自動同期（最大1時間間隔）\n• フルAPI・詳細ログ/統計・ポリシー版管理",
        de: "Empfohlen für wachsende Teams.\n• Alles aus Starter + 100M Tokens/Monat\n• Bis zu 10 Quellen-Datasets · Bis zu 10.000 Datensätze je Dataset\n• Google Sheets Auto-Sync (bis zu 1‑h Intervall)\n• Full API · Detaillierte Logs/Stats · Policy-Versionierung",
        fr: "Recommandé pour les équipes en croissance.\n• Tout Starter + 100M jetons/mois\n• Jusqu’à 10 datasets sources · 10 000 enregistrements/dataset\n• Synchronisation Google Sheets (jusqu’à 1h)\n• API complète · Logs/stats détaillés · Versioning des policies",
        it: "Consigliato per team in crescita.\n• Tutto di Starter + 100M token/mese\n• Fino a 10 dataset sorgente · 10.000 record per dataset\n• Auto-sync Google Sheets (fino a 1h)\n• API completa · Log/stats dettagliati · Versioning policy",
        zh: "適合成長中團隊的推薦計劃。\n• 包含 Starter 全部功能 + 每月 100M tokens\n• 最多 10 個來源資料集 · 每個資料集最多 10,000 筆記錄\n• Google Sheets 自動同步（最長每 1 小時一次）\n• 完整 API · 詳細日誌與統計 · 政策版本管理",
        es: "Recomendado para equipos en crecimiento.\n• Todo Starter + 100M tokens/mes\n• Hasta 10 datasets de origen · 10.000 registros por dataset\n• Auto‑sync de Google Sheets (hasta 1h)\n• API completa · Logs/estadísticas detallados · Control de versiones de políticas",
      });
    }

    if (plan === "ENTERPRISE") {
      return t({
        ko: "대규모 조직을 위한 최고 등급 플랜입니다.\n• Pro 포함 + 1B tokens/월\n• 소스 데이터셋 무제한 · 데이터셋당 최대 100,000 레코드\n• Google Sheets 자동 동기화(최대 1분 간격)\n• 우선 지원",
        en: "Built for large organizations.\n• Everything in Pro + 1B tokens/month\n• Unlimited source datasets · Up to 100,000 records per dataset\n• Google Sheets auto-sync (up to 1-minute interval)\n• Priority support",
        ja: "大規模組織向けの最上位プランです。\n• Proの全機能 + 月1Bトークン\n• ソースデータセット無制限・各最大100,000レコード\n• Google Sheets自動同期（最大1分間隔）\n• 優先サポート",
        de: "Für große Organisationen.\n• Alles aus Pro + 1B Tokens/Monat\n• Unbegrenzte Quellen-Datasets · Bis zu 100.000 Datensätze je Dataset\n• Google Sheets Auto‑Sync (bis zu 1‑min Intervall)\n• Priority Support",
        fr: "Conçu pour les grandes organisations.\n• Tout Pro + 1B jetons/mois\n• Datasets sources illimités · 100 000 enregistrements/dataset\n• Sync Google Sheets (jusqu’à 1 min)\n• Support prioritaire",
        it: "Pensato per grandi organizzazioni.\n• Tutto di Pro + 1B token/mese\n• Dataset sorgente illimitati · 100.000 record per dataset\n• Auto-sync Google Sheets (fino a 1 min)\n• Supporto prioritario",
        zh: "為大型組織而設。\n• 包含 Pro 全部功能 + 每月 1B tokens\n• 來源資料集數量不限 · 每個資料集最多 100,000 筆記錄\n• Google Sheets 自動同步（最長每 1 分鐘一次）\n• 優先支援",
        es: "Para grandes organizaciones.\n• Todo Pro + 1B tokens/mes\n• Datasets de origen ilimitados · 100.000 registros por dataset\n• Auto‑sync Google Sheets (hasta 1 min)\n• Soporte prioritario",
      });
    }

    // STARTER (default)
    return (
      t({
        ko: "소규모 팀/개인 비즈니스를 위한 입문 플랜입니다.\n• 10M tokens/월\n• 소스 데이터셋 최대 3개 · 데이터셋당 최대 1,000 레코드\n",
        en: "A great starting point for individuals and small teams.\n• 10M tokens/month\n• Up to 3 source datasets · Up to 1,000 records per dataset\n",
        ja: "個人や小規模チーム向けのスタータープランです。\n• 月10Mトークン\n• ソースデータセット最大3件・各最大1,000レコード\n",
        de: "Ein solider Einstieg für Einzelpersonen und kleine Teams.\n• 10M Tokens/Monat\n• Bis zu 3 Quellen-Datasets · Bis zu 1.000 Datensätze je Dataset\n",
        fr: "Un excellent point de départ pour les petites équipes.\n• 10M jetons/mois\n• Jusqu’à 3 datasets sources · 1 000 enregistrements/dataset\n",
        it: "Ottimo punto di partenza per singoli e piccoli team.\n• 10M token/mese\n• Fino a 3 dataset sorgente · 1.000 record per dataset\n",
        zh: "適合個人與小型團隊的入門計劃。\n• 每月 10M tokens\n• 最多 3 個來源資料集 · 每個資料集最多 1,000 筆記錄\n",
        es: "Un buen inicio para equipos pequeños o usuarios individuales.\n• 10M tokens/mes\n• Hasta 3 datasets de origen · 1.000 registros por dataset\n",
      }) + COMMON_STARTER
    );
  };

  const tokenPackName = (pack) => {
    const key = pack === "S" ? "10M" : pack === "M" ? "100M" : "1B";
    return t({
      ko: `추가 토큰 ${key} 팩`,
      en: `Add-on Tokens ${key}`,
      ja: `追加トークン ${key} パック`,
      de: `Add-on Tokens ${key}`,
      fr: `Jetons additionnels ${key}`,
      it: `Token aggiuntivi ${key}`,
      zh: `額外 tokens ${key}`,
      es: `Tokens adicionales ${key}`,
    });
  };

  const tokenPackDesc = t({
    ko: "필요할 때 한 번에 충전하는 추가 토큰입니다.\n• 결제 즉시 잔액에 추가\n• 기본 플랜 토큰 소진 후 자동 사용\n• 유효기간 1년(미사용 잔액 만료)",
    en: "One-time add-on tokens for when you need more.\n• Added to your balance instantly\n• Used automatically after your base plan tokens\n• Valid for 1 year (unused balance expires)",
    ja: "必要なときに購入できる追加トークンです。\n• 決済後すぐ残高に反映\n• 基本プラン消費後に自動利用\n• 有効期限1年（未使用分は失効）",
    de: "Einmalige Zusatz-Tokens.\n• Sofort zum Guthaben hinzugefügt\n• Automatische Nutzung nach den Basis-Tokens\n• 1 Jahr gültig (Rest verfällt)",
    fr: "Jetons additionnels en achat unique.\n• Ajout immédiat au solde\n• Utilisés après les jetons du forfait\n• Valables 1 an (solde non utilisé expiré)",
    it: "Token aggiuntivi (acquisto una tantum).\n• Aggiunti subito al saldo\n• Usati dopo i token del piano base\n• Validità 1 anno (saldo residuo scade)",
    zh: "按需要一次性購買的額外 tokens。\n• 付款後會即時加入餘額\n• 基本方案 tokens 用完後會自動使用\n• 有效期為 1 年（未使用餘額到期後失效）",
    es: "Tokens extra de compra única.\n• Se añaden al saldo al instante\n• Se usan tras los tokens del plan base\n• Válidos 1 año (el saldo sin usar caduca)",
  });

  if (variant?.kind === "subscription") {
    const plan = variant.plan || "STARTER";
    const interval = variant.interval || "month";
    return {
      name: planName(plan, interval),
      description: descriptionLineBreaks(subscriptionDescription(plan)),
    };
  }

  if (variant?.kind === "token_pack") {
    return {
      name: tokenPackName(variant.pack),
      description: descriptionLineBreaks(tokenPackDesc),
    };
  }

  return { name: t({ ko: "결제", en: "Checkout" }), description: "" };
}

/**
 * Issue Track transcript / Zendesk body labels by locale.
 * @param {string} locale
 * @returns {{
 *   noMessages: string,
 *   none: string,
 *   user: string,
 *   assistant: string,
 *   unknown: string,
 *   subjectPrefix: string,
 *   tenant: string,
 *   conversation: string,
 *   requester: string,
 *   question: string,
 *   transcript: string,
 *   defaultReplySubject: string,
 * }}
 */
function getIssueTrackCopy(locale) {
  const lang = detectLanguageFromLocale(locale);
  const copy = {
    en: {
      noMessages: "(no messages)",
      none: "(none)",
      user: "User",
      assistant: "Assistant",
      unknown: "Unknown",
      subjectPrefix: "Issue Track",
      tenant: "Tenant",
      conversation: "Conversation",
      requester: "Requester",
      question: "Question",
      transcript: "Transcript",
      defaultReplySubject: "Update",
    },
    ko: {
      noMessages: "(메시지 없음)",
      none: "(없음)",
      user: "방문객",
      assistant: "답변",
      unknown: "기타",
      subjectPrefix: "이슈 트랙",
      tenant: "채널",
      conversation: "대화",
      requester: "문의자",
      question: "질문",
      transcript: "대화 내용",
      defaultReplySubject: "답변 안내",
    },
    ja: {
      noMessages: "(メッセージなし)",
      none: "(なし)",
      user: "ユーザー",
      assistant: "アシスタント",
      unknown: "不明",
      subjectPrefix: "イシュートラック",
      tenant: "テナント",
      conversation: "会話",
      requester: "依頼者",
      question: "質問",
      transcript: "会話内容",
      defaultReplySubject: "更新",
    },
    de: {
      noMessages: "(keine Nachrichten)",
      none: "(keine)",
      user: "Benutzer",
      assistant: "Assistent",
      unknown: "Unbekannt",
      subjectPrefix: "Issue-Track",
      tenant: "Mandant",
      conversation: "Gespräch",
      requester: "Anfragender",
      question: "Frage",
      transcript: "Verlauf",
      defaultReplySubject: "Update",
    },
    fr: {
      noMessages: "(aucun message)",
      none: "(aucun)",
      user: "Utilisateur",
      assistant: "Assistant",
      unknown: "Inconnu",
      subjectPrefix: "Suivi des tickets",
      tenant: "Locataire",
      conversation: "Conversation",
      requester: "Demandeur",
      question: "Question",
      transcript: "Transcription",
      defaultReplySubject: "Mise à jour",
    },
    it: {
      noMessages: "(nessun messaggio)",
      none: "(nessuno)",
      user: "Utente",
      assistant: "Assistente",
      unknown: "Sconosciuto",
      subjectPrefix: "Tracciamento ticket",
      tenant: "Tenant",
      conversation: "Conversazione",
      requester: "Richiedente",
      question: "Domanda",
      transcript: "Trascrizione",
      defaultReplySubject: "Aggiornamento",
    },
    zh: {
      noMessages: "(無訊息)",
      none: "(無)",
      user: "使用者",
      assistant: "助理",
      unknown: "未知",
      subjectPrefix: "工單追蹤",
      tenant: "租戶",
      conversation: "對話",
      requester: "請求者",
      question: "問題",
      transcript: "對話內容",
      defaultReplySubject: "更新",
    },
    es: {
      noMessages: "(sin mensajes)",
      none: "(ninguno)",
      user: "Usuario",
      assistant: "Asistente",
      unknown: "Desconocido",
      subjectPrefix: "Seguimiento de incidencias",
      tenant: "Inquilino",
      conversation: "Conversación",
      requester: "Solicitante",
      question: "Pregunta",
      transcript: "Transcripción",
      defaultReplySubject: "Actualización",
    },
  };
  return copy[lang] || copy.en;
}

module.exports = {
  detectLanguageFromLocale,
  getLocalizedErrorMessage,
  getLocalizedStatusMessage,
  getLocalizedThinkingMessage,
  detectLanguageAndGetNoResultMessage,
  getNoDatasetsMessage,
  getBillingCheckoutProductOptions,
  getIssueTrackCopy,
};