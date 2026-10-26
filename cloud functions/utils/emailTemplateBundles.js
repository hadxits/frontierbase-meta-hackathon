/**
 * 이메일 마크업·다국어 문구 (배포 시 fs 없이 번들에 포함됨).
 * 템플릿 추가: 키 + bodyHtml + strings 객체를 여기에 등록하고 TEMPLATE_ID_BY_CODE에 연결.
 * strings 줄바꿈: `\n` 만 사용 (`<br>` 태그 금지). 렌더 시 emailTemplates.js 가 `<br />` 로 변환.
 */

const EMAIL_TEMPLATE_BUNDLES = {
  welcome: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
        <tbody>
          <tr>
            <td style="padding:16px 12px">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
              <tbody>
                <tr>
                  <td align="center" style="padding:40px 32px 24px">
                    <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                  </td>
                </tr>
                <tr style="text-align:center">
                  <td style="padding:0 32px 40px">
                    <p style="margin:0 0 20px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{hey}}</p>
                    <p style="margin:0 0 20px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{welcome}}</p>
                    <p style="margin:0 0 24px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{body}}</p>
                    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody><tr><td style="padding:8px 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            </td>
          </tr>
        </tbody>
      </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        subject: "Welcome to FrontierBase",
        hey_with_name: "Hey {{displayName}} 👋",
        hey_default: "Hey 👋",
        welcome: "Welcome to **FrontierBase**.",
        body: "Your AI chatbot is ready to answer accurately based on the data you upload.\nConnect your data now and start with your first question right away.",
        cta_explore: "Explore features",
      },
      ko: {
        subject: "FrontierBase에 오신 것을 환영합니다",
        hey_with_name: "{{displayName}}님, 안녕하세요 👋",
        hey_default: "안녕하세요 👋",
        welcome: "**FrontierBase**에 오신 것을 환영합니다.",
        body: "업로드한 데이터를 바탕으로 정확하게 답하는 AI 챗봇이 준비되어 있습니다.\n지금 데이터를 연결하고 바로 첫 질문을 시작해보세요.",
        cta_explore: "기능 둘러보기",
      },
      ja: {
        subject: "Frontierbaseへようこそ",
        hey_with_name: "{{displayName}}さん、こんにちは 👋",
        hey_default: "こんにちは 👋",
        welcome: "**FrontierBase**へようこそ。",
        body: "アップロードしたデータをもとに、正確に答えるAIチャットがすぐに使えます。\n今すぐデータをつないで、最初の質問を始めましょう。",
        cta_explore: "機能を見る",
      },
      de: {
        subject: "Willkommen bei FrontierBase",
        hey_with_name: "Hallo {{displayName}} 👋",
        hey_default: "Hallo 👋",
        welcome: "Willkommen bei **FrontierBase**.",
        body: "Ihr KI-Chatbot ist bereit und beantwortet Fragen präzise auf Basis Ihrer hochgeladenen Daten.\nVerbinden Sie jetzt Ihre Daten und stellen Sie direkt Ihre erste Frage.",
        cta_explore: "Funktionen ansehen",
      },
      fr: {
        subject: "Bienvenue sur FrontierBase",
        hey_with_name: "Bonjour {{displayName}} 👋",
        hey_default: "Bonjour 👋",
        welcome: "Bienvenue sur **FrontierBase**.",
        body: "Votre assistant est prêt à répondre avec précision à partir des données que vous importez.\nConnectez vos données dès maintenant et lancez votre première question.",
        cta_explore: "Voir les fonctionnalités",
      },
      it: {
        subject: "Benvenuto su FrontierBase",
        hey_with_name: "Ciao {{displayName}} 👋",
        hey_default: "Ciao 👋",
        welcome: "Benvenuto su **FrontierBase**.",
        body: "Il tuo chatbot AI è pronto a rispondere con precisione in base ai dati che carichi.\nCollega subito i tuoi dati e inizia con la prima domanda.",
        cta_explore: "Scopri le funzioni",
      },
      zh: {
        subject: "歡迎使用 FrontierBase",
        hey_with_name: "{{displayName}}，你好 👋",
        hey_default: "你好 👋",
        welcome: "歡迎使用 **FrontierBase**。",
        body: "你的 AI 助理已準備就緒，能根據你上傳的資料提供準確回答。\n現在就連接資料，直接開始你的第一個提問。",
        cta_explore: "探索功能",
      },
      es: {
        subject: "Bienvenido a FrontierBase",
        hey_with_name: "Hola {{displayName}} 👋",
        hey_default: "Hola 👋",
        welcome: "Bienvenido a **FrontierBase**.",
        body: "Tu chatbot con IA ya está listo para responder con precisión a partir de los datos que subas.\nConecta tus datos ahora y empieza de inmediato con tu primera pregunta.",
        cta_explore: "Ver funciones",
      },
    },
  },

  dataset_ready: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5">{{hey}}</p>
    <p style="margin:0;font-size:16px;color:#e5e5e5">{{body}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "Your dataset is ready",
        hey_with_name: "Hey {{displayName}} 👋",
        hey_default: "Hey 👋",
        body: '"{{datasetName}}" is ready to use.',
      },
      ko: {
        subject: "데이터셋이 준비되었습니다",
        hey_with_name: "{{displayName}}님, 👋",
        hey_default: "안녕하세요 👋",
        body: '"{{datasetName}}"(이)가 사용할 준비가 되었습니다.',
      },
      ja: {
        subject: "データセットの準備ができました",
        hey_with_name: "{{displayName}}さん 👋",
        hey_default: "こんにちは 👋",
        body: "「{{datasetName}}」の準備ができました。",
      },
      de: {
        subject: "Ihr Datensatz ist bereit",
        hey_with_name: "Hallo {{displayName}} 👋",
        hey_default: "Hallo 👋",
        body: '"{{datasetName}}" ist einsatzbereit.',
      },
      fr: {
        subject: "Votre jeu de données est prêt",
        hey_with_name: "Bonjour {{displayName}} 👋",
        hey_default: "Bonjour 👋",
        body: '"{{datasetName}}" est prêt.',
      },
      it: {
        subject: "Il tuo dataset è pronto",
        hey_with_name: "Ciao {{displayName}} 👋",
        hey_default: "Ciao 👋",
        body: '"{{datasetName}}" è pronto.',
      },
      zh: {
        subject: "你的資料集已準備就緒",
        hey_with_name: "{{displayName}}，你好 👋",
        hey_default: "你好 👋",
        body: "「{{datasetName}}」已可使用。",
      },
      es: {
        subject: "Tu conjunto de datos está listo",
        hey_with_name: "Hola {{displayName}} 👋",
        hey_default: "Hola 👋",
        body: '"{{datasetName}}" está listo.',
      },
    },
  },

  dataset_deletion: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
        <tbody>
          <tr>
            <td style="padding:16px 12px">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
              <tbody>
                <tr>
                  <td align="center" style="padding:40px 32px 16px">
                    <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 40px;text-align:left">
                    <h1 style="margin:0;font-size:20px;line-height:1.35;font-weight:700;color:#d93025">{{warningTitle}}</h1>
                    <p style="margin:10px 0 0 0;font-size:15px;line-height:1.5;color:#d4d4d4">{{datasetLabel}}</p>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:20px 0 0 0">
                      <tbody><tr><td style="padding:0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:20px 0 0 0;font-size:16px;line-height:1.6;color:#e5e5e5">{{hey}}</p>
                    <p style="margin:16px 0 0 0;font-size:15px;line-height:1.65;color:#b0b0b0">{{p1}}</p>
                    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.65;color:#b0b0b0">{{p2}}</p>
                    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.65;color:#d4d4d4">{{p3}}</p>
                    {{stepsHtml}}
                    <div style="margin:24px 0 0 0">{{ctaHtml}}</div>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody><tr><td style="padding:24px 0 8px 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#808080;text-align:center">©{{year}} HADFAMILY Inc.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            </td>
          </tr>
        </tbody>
      </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        subject: 'Dataset removed: "{{datasetName}}"',
        warning_title: "Dataset deletion notice",
        dataset_label: "Affected dataset: {{datasetName}}",
        hey_with_name: "Hello {{displayName}},",
        hey_default: "Hello,",
        p1: "The dataset \"{{datasetName}}\" is no longer active in this workspace as of {{removedAt}}.\nDepending on your workspace settings, it may remain recoverable for a limited time before it is permanently purged.",
        p2: "If recovery is available, complete the steps below before **{{recoveryDeadline}}**.",
        p3: "After **{{recoveryDeadline}}**, recovery may no longer be possible.",
        step1: "Click **Go to recovery** below to open the recovery screen.",
        step2: "Select the dataset you want to recover.",
        step3: "Confirm the recovery, then check that the dataset is active again.",
        cta_open_console: "Go to recovery",
      },
      ko: {
        subject: '데이터셋 삭제 알림: "{{datasetName}}"',
        warning_title: "데이터셋 삭제 안내",
        dataset_label: "대상 데이터셋: {{datasetName}}",
        hey_with_name: "{{displayName}}님, 안녕하세요.",
        hey_default: "안녕하세요.",
        p1: "{{removedAt}} 기준으로 \"{{datasetName}}\" 데이터셋이 이 워크스페이스에서 비활성 처리되었습니다.\n워크스페이스 설정에 따라 일정 기간 동안만 복구가 가능할 수 있으며, 이후에는 영구 삭제될 수 있습니다.",
        p2: "복구가 가능한 경우 **{{recoveryDeadline}}** 이전에 아래 절차를 완료해 주세요.",
        p3: "**{{recoveryDeadline}}** 이후에는 복구가 불가능할 수 있습니다.",
        step1: "아래 **복구 화면 이동** 버튼을 클릭하세요.",
        step2: "복구해야 할 데이터셋을 선택하세요.",
        step3: "복구를 진행한 뒤 데이터셋이 다시 활성화되었는지 확인하세요.",
        cta_open_console: "복구 화면 이동",
      },
      ja: {
        subject: "データセット削除のお知らせ: 「{{datasetName}}」",
        warning_title: "データセット削除の通知",
        dataset_label: "対象データセット: {{datasetName}}",
        hey_with_name: "{{displayName}}さん、こんにちは。",
        hey_default: "こんにちは。",
        p1: "{{removedAt}} 時点で、データセット「{{datasetName}}」はこのワークスペースで無効化されました。\nワークスペースの設定により、一定期間のみ復旧できる場合があります。その後は完全に削除される可能性があります。",
        p2: "復旧できる場合は、**{{recoveryDeadline}}** までに以下の手順を完了してください。",
        p3: "**{{recoveryDeadline}}** を過ぎると、復旧できない場合があります。",
        step1: "下の**復旧画面へ移動**ボタンをクリックしてください。",
        step2: "復旧するデータセットを選択してください。",
        step3: "復旧を実行し、データセットが再び有効になったことを確認してください。",
        cta_open_console: "復旧画面へ移動",
      },
      de: {
        subject: "Datensatz entfernt: „{{datasetName}}“",
        warning_title: "Hinweis zur Datensatzlöschung",
        dataset_label: "Betroffener Datensatz: {{datasetName}}",
        hey_with_name: "Hallo {{displayName}},",
        hey_default: "Hallo,",
        p1: "Der Datensatz „{{datasetName}}“ ist in diesem Workspace seit {{removedAt}} nicht mehr aktiv.\nJe nach Workspace-Einstellungen kann er für begrenzte Zeit wiederherstellbar sein, bevor er endgültig entfernt wird.",
        p2: "Wenn eine Wiederherstellung möglich ist, schließen Sie die Schritte unten vor **{{recoveryDeadline}}** ab.",
        p3: "Nach **{{recoveryDeadline}}** ist eine Wiederherstellung unter Umständen nicht mehr möglich.",
        step1: "Klicken Sie unten auf **Zur Wiederherstellung**, um die Wiederherstellungsseite zu öffnen.",
        step2: "Wählen Sie den Datensatz aus, den Sie wiederherstellen möchten.",
        step3: "Starten Sie die Wiederherstellung und prüfen Sie danach, ob der Datensatz wieder aktiv ist.",
        cta_open_console: "Zur Wiederherstellung",
      },
      fr: {
        subject: "Jeu de données supprimé : « {{datasetName}} »",
        warning_title: "Avis de suppression de jeu de données",
        dataset_label: "Jeu de données concerné : {{datasetName}}",
        hey_with_name: "Bonjour {{displayName}},",
        hey_default: "Bonjour,",
        p1: "Le jeu de données « {{datasetName}} » n’est plus actif dans cet espace de travail depuis le {{removedAt}}.\nSelon la configuration, il peut rester récupérable pendant une durée limitée avant suppression définitive.",
        p2: "Si une récupération est possible, suivez les étapes ci-dessous avant le **{{recoveryDeadline}}**.",
        p3: "Après le **{{recoveryDeadline}}**, la récupération peut ne plus être possible.",
        step1: "Cliquez sur **Accéder à la récupération** ci-dessous pour ouvrir l’écran de récupération.",
        step2: "Sélectionnez le jeu de données à récupérer.",
        step3: "Lancez la récupération, puis vérifiez que le jeu de données est de nouveau actif.",
        cta_open_console: "Accéder à la récupération",
      },
      it: {
        subject: 'Dataset rimosso: "{{datasetName}}"',
        warning_title: "Avviso di rimozione dataset",
        dataset_label: "Dataset interessato: {{datasetName}}",
        hey_with_name: "Ciao {{displayName}},",
        hey_default: "Ciao,",
        p1: "Il dataset \"{{datasetName}}\" non è più attivo in questo workspace a partire da {{removedAt}}.\nIn base alle impostazioni, potrebbe essere recuperabile per un periodo limitato prima dell’eliminazione definitiva.",
        p2: "Se il recupero è disponibile, completa i passaggi seguenti entro il **{{recoveryDeadline}}**.",
        p3: "Dopo il **{{recoveryDeadline}}**, il recupero potrebbe non essere più possibile.",
        step1: "Fai clic su **Vai al recupero** qui sotto per aprire la schermata di recupero.",
        step2: "Seleziona il dataset da recuperare.",
        step3: "Avvia il recupero e verifica che il dataset sia di nuovo attivo.",
        cta_open_console: "Vai al recupero",
      },
      zh: {
        subject: "資料集已移除：「{{datasetName}}」",
        warning_title: "資料集刪除通知",
        dataset_label: "受影響的資料集：{{datasetName}}",
        hey_with_name: "{{displayName}}，您好：",
        hey_default: "您好：",
        p1: "自 {{removedAt}} 起，資料集「{{datasetName}}」在此工作區已不再可用。\n視工作區設定而定，可能在一段時間內仍可復原，之後將可能被永久清除。",
        p2: "若仍可復原，請在 **{{recoveryDeadline}}** 前完成下列步驟。",
        p3: "超過 **{{recoveryDeadline}}** 後，可能無法再復原。",
        step1: "點擊下方的**前往復原畫面**按鈕。",
        step2: "選擇要復原的資料集。",
        step3: "執行復原後，確認資料集已重新啟用。",
        cta_open_console: "前往復原畫面",
      },
      es: {
        subject: 'Conjunto de datos eliminado: "{{datasetName}}"',
        warning_title: "Aviso de eliminación de conjunto de datos",
        dataset_label: "Conjunto afectado: {{datasetName}}",
        hey_with_name: "Hola, {{displayName}}:",
        hey_default: "Hola:",
        p1: "El conjunto de datos \"{{datasetName}}\" dejó de estar activo en este espacio de trabajo el {{removedAt}}.\nSegún la configuración, podría seguir siendo recuperable durante un tiempo limitado antes de eliminarse por completo.",
        p2: "Si hay recuperación disponible, completa los pasos siguientes antes del **{{recoveryDeadline}}**.",
        p3: "Después del **{{recoveryDeadline}}**, es posible que ya no se pueda recuperar.",
        step1: "Haz clic en **Ir a recuperación** abajo para abrir la pantalla de recuperación.",
        step2: "Selecciona el conjunto de datos que quieres recuperar.",
        step3: "Inicia la recuperación y comprueba que el conjunto vuelva a estar activo.",
        cta_open_console: "Ir a recuperación",
      },
    },
  },

  channel_deletion: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
        <tbody>
          <tr>
            <td style="padding:16px 12px">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
              <tbody>
                <tr>
                  <td align="center" style="padding:40px 32px 16px">
                    <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 32px 40px;text-align:left">
                    <h1 style="margin:0;font-size:20px;line-height:1.35;font-weight:700;color:#d93025">{{warningTitle}}</h1>
                    <p style="margin:10px 0 0 0;font-size:15px;line-height:1.5;color:#d4d4d4">{{channelLabel}}</p>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%" style="margin:20px 0 0 0">
                      <tbody><tr><td style="padding:0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:20px 0 0 0;font-size:16px;line-height:1.6;color:#e5e5e5">{{hey}}</p>
                    <p style="margin:16px 0 0 0;font-size:15px;line-height:1.65;color:#b0b0b0">{{p1}}</p>
                    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.65;color:#b0b0b0">{{p2}}</p>
                    <p style="margin:14px 0 0 0;font-size:15px;line-height:1.65;color:#d4d4d4">{{p3}}</p>
                    {{stepsHtml}}
                    <div style="margin:24px 0 0 0">{{ctaHtml}}</div>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody><tr><td style="padding:24px 0 8px 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#808080;text-align:center">©{{year}} HADFAMILY Inc.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            </td>
          </tr>
        </tbody>
      </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        subject: 'Channel removed: "{{channelName}}"',
        warning_title: "Channel deletion notice",
        channel_label: "Affected channel: {{channelName}}",
        hey_with_name: "Hello {{displayName}},",
        hey_default: "Hello,",
        p1: "As of {{removedAt}}, chat on \"{{channelName}}\" is no longer available.\nYou can restore it for a limited time before it may be permanently removed.",
        p2: "If you want to restore it, finish the steps below before **{{recoveryDeadline}}**.",
        p3: "After **{{recoveryDeadline}}**, it may no longer be possible to restore.",
        step1: "Click **Go to recovery** below to open the recovery page.",
        step2: "Find the channel you want to restore, then click **Restore**.",
        step3: "Check that the channel appears again in your channel list.",
        cta_open_console: "Go to recovery",
      },
      ko: {
        subject: '채널 삭제 알림: "{{channelName}}"',
        warning_title: "채널 삭제 안내",
        channel_label: "대상 채널: {{channelName}}",
        hey_with_name: "{{displayName}}님, 안녕하세요.",
        hey_default: "안녕하세요.",
        p1: "{{removedAt}}부터 \"{{channelName}}\" 채널에서는 대화를 할 수 없습니다.\n일정 기간 안에는 다시 살릴 수 있으며, 이후에는 완전히 삭제될 수 있습니다.",
        p2: "복구하려면 **{{recoveryDeadline}}** 전에 아래 절차를 완료해 주세요.",
        p3: "**{{recoveryDeadline}}** 이후에는 복구가 어려울 수 있습니다.",
        step1: "아래 **복구 페이지로 이동**을 눌러 주세요.",
        step2: "복구할 채널을 찾은 뒤 **복구하기**를 눌러 주세요.",
        step3: "채널 목록에 다시 나타나는지 확인해 주세요.",
        cta_open_console: "복구 페이지로 이동",
      },
      ja: {
        subject: "チャンネル削除のお知らせ: 「{{channelName}}」",
        warning_title: "チャンネル削除の通知",
        channel_label: "対象チャンネル: {{channelName}}",
        hey_with_name: "{{displayName}}さん、こんにちは。",
        hey_default: "こんにちは。",
        p1: "{{removedAt}} 以降、チャンネル「{{channelName}}」ではチャットを使えません。\n一定期間内なら元に戻せますが、その後は完全に削除される場合があります。",
        p2: "復元する場合は、**{{recoveryDeadline}}** までに以下の手順を完了してください。",
        p3: "**{{recoveryDeadline}}** を過ぎると、復元できない場合があります。",
        step1: "下の**復元ページへ移動**を押してください。",
        step2: "復元するチャンネルを見つけ、**復元する**を押してください。",
        step3: "チャンネル一覧に再び表示されることを確認してください。",
        cta_open_console: "復元ページへ移動",
      },
      de: {
        subject: "Kanal entfernt: „{{channelName}}“",
        warning_title: "Hinweis zur Kanallöschung",
        channel_label: "Betroffener Kanal: {{channelName}}",
        hey_with_name: "Hallo {{displayName}},",
        hey_default: "Hallo,",
        p1: "Seit {{removedAt}} ist Chat im Kanal „{{channelName}}“ nicht mehr verfügbar.\nSie können ihn für begrenzte Zeit wiederherstellen, bevor er dauerhaft entfernt werden kann.",
        p2: "Wenn Sie ihn wiederherstellen möchten, schließen Sie die Schritte unten vor **{{recoveryDeadline}}** ab.",
        p3: "Nach **{{recoveryDeadline}}** ist eine Wiederherstellung unter Umständen nicht mehr möglich.",
        step1: "Klicken Sie unten auf **Zur Wiederherstellung**, um die Seite zu öffnen.",
        step2: "Suchen Sie den gewünschten Kanal und klicken Sie auf **Wiederherstellen**.",
        step3: "Prüfen Sie, ob der Kanal wieder in Ihrer Kanalliste erscheint.",
        cta_open_console: "Zur Wiederherstellung",
      },
      fr: {
        subject: "Canal supprimé : « {{channelName}} »",
        warning_title: "Avis de suppression de canal",
        channel_label: "Canal concerné : {{channelName}}",
        hey_with_name: "Bonjour {{displayName}},",
        hey_default: "Bonjour,",
        p1: "Depuis le {{removedAt}}, le chat n’est plus disponible sur « {{channelName}} ».\nVous pouvez le rétablir pendant une durée limitée avant une éventuelle suppression définitive.",
        p2: "Pour le rétablir, suivez les étapes ci-dessous avant le **{{recoveryDeadline}}**.",
        p3: "Après le **{{recoveryDeadline}}**, le rétablissement peut ne plus être possible.",
        step1: "Cliquez sur **Accéder à la récupération** ci-dessous pour ouvrir la page.",
        step2: "Trouvez le canal à rétablir, puis cliquez sur **Rétablir**.",
        step3: "Vérifiez que le canal réapparaît dans votre liste de canaux.",
        cta_open_console: "Accéder à la récupération",
      },
      it: {
        subject: 'Canale rimosso: "{{channelName}}"',
        warning_title: "Avviso di rimozione canale",
        channel_label: "Canale interessato: {{channelName}}",
        hey_with_name: "Ciao {{displayName}},",
        hey_default: "Ciao,",
        p1: "Dal {{removedAt}}, la chat sul canale \"{{channelName}}\" non è più disponibile.\nPuoi ripristinarlo per un periodo limitato prima che possa essere eliminato definitivamente.",
        p2: "Per ripristinarlo, completa i passaggi seguenti entro il **{{recoveryDeadline}}**.",
        p3: "Dopo il **{{recoveryDeadline}}**, il ripristino potrebbe non essere più possibile.",
        step1: "Fai clic su **Vai al recupero** qui sotto per aprire la pagina.",
        step2: "Trova il canale da ripristinare, poi fai clic su **Ripristina**.",
        step3: "Verifica che il canale ricompaia nell’elenco dei canali.",
        cta_open_console: "Vai al recupero",
      },
      zh: {
        subject: "頻道已移除：「{{channelName}}」",
        warning_title: "頻道刪除通知",
        channel_label: "受影響的頻道：{{channelName}}",
        hey_with_name: "{{displayName}}，您好：",
        hey_default: "您好：",
        p1: "自 {{removedAt}} 起，頻道「{{channelName}}」無法再進行對話。\n在有限時間內可復原，之後可能被永久刪除。",
        p2: "若要復原，請在 **{{recoveryDeadline}}** 前完成下列步驟。",
        p3: "超過 **{{recoveryDeadline}}** 後，可能無法再復原。",
        step1: "點擊下方的**前往復原畫面**開啟復原頁面。",
        step2: "找到要復原的頻道，然後點擊**復原**。",
        step3: "確認頻道已重新出現在頻道列表中。",
        cta_open_console: "前往復原畫面",
      },
      es: {
        subject: 'Canal eliminado: "{{channelName}}"',
        warning_title: "Aviso de eliminación de canal",
        channel_label: "Canal afectado: {{channelName}}",
        hey_with_name: "Hola, {{displayName}}:",
        hey_default: "Hola:",
        p1: "Desde el {{removedAt}}, el chat en \"{{channelName}}\" ya no está disponible.\nPuedes restaurarlo durante un tiempo limitado antes de que pueda eliminarse de forma permanente.",
        p2: "Si quieres restaurarlo, completa los pasos siguientes antes del **{{recoveryDeadline}}**.",
        p3: "Después del **{{recoveryDeadline}}**, es posible que ya no se pueda restaurar.",
        step1: "Haz clic en **Ir a recuperación** abajo para abrir la página.",
        step2: "Busca el canal que quieres restaurar y haz clic en **Restaurar**.",
        step3: "Comprueba que el canal vuelva a aparecer en tu lista de canales.",
        cta_open_console: "Ir a recuperación",
      },
    },
  },

  channel_invite: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
        <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
          <tbody>
            <tr>
              <td style="padding:16px 12px">
                <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
                  <tbody>
                    <tr>
                      <td align="center" style="padding:40px 32px 16px">
                        <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:0 32px 40px;text-align:center">
                        <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.35;font-weight:600;color:#e5e5e5">{{title}}</h1>
                        <p style="margin:0 0 8px 0;font-size:16px;line-height:1.6;color:#b0b0b0">{{line1}}</p>
                        <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:#b0b0b0">{{line2}}</p>
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:24px 0 0 0;background-color:#111111;border-radius:12px;border:1px solid #1a1a1a;overflow:hidden">
                          <tr>
                            <td style="padding:16px 16px 16px">
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                <tr>
                                  <td width="44" valign="top" style="padding-right:12px">{{channelCardThumbHtml}}</td>
                                  <td valign="middle" style="text-align:left">
                                    <p style="margin:0;font-size:15px;font-weight:600;color:#e5e5e5">{{channelName}}</p>
                                    <p style="margin:4px 0 0 0;font-size:13px;color:#808080">{{cardSubtitle}}</p>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <div style="margin:28px 0 0 0">{{ctaHtml}}</div>
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                          <tbody><tr><td style="padding:24px 0 8px 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                        </table>
                        <p style="margin:16px 0 12px 0;font-size:13px;line-height:1.5;color:#a3a3a3;text-align:center">{{footerTagline}}</p>
                        <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;color:#808080;text-align:center">{{footerLinksHtml}}</p>
                        <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                          <tbody><tr><td style="padding:8px 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                        </table>
                        <p style="margin:24px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        default_sender: "Someone",
        subject: '{{sender}} invited you to the "{{channelName}}" channel in FrontierBase',
        title: '{{sender}} invited you to\nthe "{{channelName}}" channel\nin FrontierBase',
        body_line1: "You've been invited.",
        body_line2: "Start working with data and AI together.",
        card_subtitle: "Channel · FrontierBase",
        cta: "Accept invite",
        footer_tagline: "Connect your data. Chat with AI.\nBuilt for teams.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">Privacy Policy</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">Browse</a>',
      },
      ko: {
        default_sender: "팀원",
        subject: '{{sender}}님이 FrontierBase의 "{{channelName}}" 채널에 당신을 초대했습니다',
        title: '{{sender}}님이 FrontierBase의 \n"{{channelName}}" 채널에 \n당신을 초대했습니다',
        body_line1: "채널에 초대되었습니다.",
        body_line2: "데이터와 AI로 함께 작업을 시작해 보세요.",
        card_subtitle: "채널 · FrontierBase",
        cta: "초대 수락",
        footer_tagline: "데이터를 연결하고, AI와 대화하세요.\n팀을 위한 워크스페이스입니다.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">개인정보 처리방침</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">둘러보기</a>',
      },
      ja: {
        default_sender: "メンバー",
        subject: "{{sender}}さんがFrontierBaseの「{{channelName}}」チャンネルにあなたを招待しました",
        title: "{{sender}}さんがFrontierBaseの\n「{{channelName}}」チャンネルに\nあなたを招待しました",
        body_line1: "招待が届いています。",
        body_line2: "データとAIで一緒に始めましょう。",
        card_subtitle: "チャンネル · FrontierBase",
        cta: "招待を受け入れる",
        footer_tagline: "データをつなぎ、AIと対話。\nチームのためのワークスペース。",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">プライバシー</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">見てみる</a>',
      },
      de: {
        default_sender: "Ein Mitglied",
        subject: "{{sender}} hat dich zum Kanal „{{channelName}}“ in FrontierBase eingeladen",
        title: "{{sender}} hat dich in FrontierBase\nzum Kanal „{{channelName}}“\neingeladen",
        body_line1: "Du bist eingeladen.",
        body_line2: "Arbeite gemeinsam mit Daten und KI.",
        card_subtitle: "Kanal · FrontierBase",
        cta: "Einladung annehmen",
        footer_tagline: "Daten verbinden. Mit KI chatten.\nFür Teams gebaut.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">Datenschutz</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">Entdecken</a>',
      },
      fr: {
        default_sender: "Un membre",
        subject: "{{sender}} vous a invité sur le canal « {{channelName}} » dans FrontierBase",
        title: "{{sender}} vous a invité sur le canal\n« {{channelName}} »\ndans FrontierBase",
        body_line1: "Vous avez une invitation.",
        body_line2: "Commencez à travailler avec vos données et l’IA.",
        card_subtitle: "Canal · FrontierBase",
        cta: "Accepter l’invitation",
        footer_tagline: "Connectez vos données. Discutez avec l’IA.\nPensé pour les équipes.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">Confidentialité</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">Découvrir</a>',
      },
      it: {
        default_sender: "Un membro",
        subject: '{{sender}} ti ha invitato al canale "{{channelName}}" in FrontierBase',
        title: '{{sender}} ti ha invitato al canale\n"{{channelName}}"\nin FrontierBase',
        body_line1: "Hai ricevuto un invito.",
        body_line2: "Inizia a lavorare con dati e IA insieme.",
        card_subtitle: "Canale · FrontierBase",
        cta: "Accetta invito",
        footer_tagline: "Collega i tuoi dati. Chatta con l’IA.\nProgettato per i team.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">Privacy</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">Scopri</a>',
      },
      zh: {
        default_sender: "成員",
        subject: "{{sender}} 邀請你加入 FrontierBase 的「{{channelName}}」頻道",
        title: "{{sender}} 邀請你加入 FrontierBase 的\n「{{channelName}}」\n頻道",
        body_line1: "你收到了一則邀請。",
        body_line2: "開始與資料和 AI 一起協作。",
        card_subtitle: "頻道 · FrontierBase",
        cta: "接受邀請",
        footer_tagline: "連接資料、與 AI 對話，\n為團隊而設。",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">隱私權政策</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">逛逛</a>',
      },
      es: {
        default_sender: "Alguien",
        subject: '{{sender}} te invitó al canal "{{channelName}}" en FrontierBase',
        title: '{{sender}} te invitó al canal\n"{{channelName}}"\nen FrontierBase',
        body_line1: "Tienes una invitación.",
        body_line2: "Empieza a trabajar con datos e IA en equipo.",
        card_subtitle: "Canal · FrontierBase",
        cta: "Aceptar invitación",
        footer_tagline: "Conecta tus datos. Chatea con IA.\nHecho para equipos.",
        footer_links_html:
          '<a href="https://frontierbase.io/privacy" style="color:#bbbbbb;text-decoration:underline">Privacidad</a> &middot; <a href="https://frontierbase.io" style="color:#bbbbbb;text-decoration:underline">Descubrir</a>',
      },
    },
  },

  support_confirmation: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_title}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{requestTitle}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_contents}}</p>
    <div style="margin:0;padding:16px;background:#111111;border-radius:8px;border:1px solid #1a1a1a;font-size:15px;color:#e5e5e5;line-height:1.65;white-space:pre-wrap">{{requestContentsHtml}}</div>
    <p style="margin:20px 0 0 0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[{{ticketNumber}}] We received your support request",
        hey_default: "Hello 👋",
        intro:
          "Thank you for contacting FrontierBase support.\nYour request has been received.",
        label_title: "Subject",
        label_contents: "Message",
        footer_note:
          "Our team will review your request.\nWe will get back to you as soon as possible.",
      },
      ko: {
        subject: "[{{ticketNumber}}] 지원 요청이 접수되었습니다",
        hey_default: "안녕하세요 👋",
        intro:
          "FrontierBase 지원팀에 문의해 주셔서 감사합니다.\n요청이 정상적으로 접수되었습니다.",
        label_title: "제목",
        label_contents: "내용",
        footer_note:
          "담당 팀이 요청 내용을 검토한 뒤\n가능한 한 빨리 답변드리겠습니다.",
      },
      ja: {
        subject: "[{{ticketNumber}}] サポートリクエストを受け付けました",
        hey_default: "こんにちは 👋",
        intro:
          "FrontierBase サポートにお問い合わせいただきありがとうございます。\nリクエストを受け付けました。",
        label_title: "件名",
        label_contents: "内容",
        footer_note:
          "担当チームが内容を確認します。\nできるだけ早くご連絡いたします。",
      },
      de: {
        subject: "[{{ticketNumber}}] Ihre Support-Anfrage ist eingegangen",
        hey_default: "Hallo 👋",
        intro:
          "Vielen Dank für Ihre Nachricht an den FrontierBase-Support.\nIhre Anfrage wurde erfasst.",
        label_title: "Betreff",
        label_contents: "Nachricht",
        footer_note:
          "Unser Team prüft Ihre Anfrage.\nWir melden uns so schnell wie möglich bei Ihnen.",
      },
      fr: {
        subject: "[{{ticketNumber}}] Nous avons bien reçu votre demande",
        hey_default: "Bonjour 👋",
        intro:
          "Merci d'avoir contacté le support FrontierBase.\nVotre demande a bien été enregistrée.",
        label_title: "Objet",
        label_contents: "Message",
        footer_note:
          "Notre équipe examinera votre demande.\nNous vous répondrons dès que possible.",
      },
      it: {
        subject: "[{{ticketNumber}}] Abbiamo ricevuto la tua richiesta",
        hey_default: "Ciao 👋",
        intro:
          "Grazie per aver contattato il supporto FrontierBase.\nLa richiesta è stata registrata.",
        label_title: "Oggetto",
        label_contents: "Messaggio",
        footer_note:
          "Il nostro team esaminerà la richiesta.\nTi risponderà il prima possibile.",
      },
      zh: {
        subject: "[{{ticketNumber}}] 我們已收到您的支援請求",
        hey_default: "你好 👋",
        intro:
          "感謝您聯絡 FrontierBase 支援。\n您的請求已成功提交。",
        label_title: "主旨",
        label_contents: "內容",
        footer_note: "我們的團隊會審閱您的請求。\n並儘快回覆您。",
      },
      es: {
        subject: "[{{ticketNumber}}] Hemos recibido tu solicitud de soporte",
        hey_default: "Hola 👋",
        intro:
          "Gracias por contactar con el soporte de FrontierBase.\nTu solicitud se ha registrado correctamente.",
        label_title: "Asunto",
        label_contents: "Mensaje",
        footer_note:
          "Nuestro equipo revisará tu solicitud.\nTe responderemos lo antes posible.",
      },
    },
  },

  support_admin_notification: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_ticket}}</p>
    <p style="margin:0 0 16px 0;font-size:16px;color:#ffffff;line-height:1.6">{{ticketNumber}} <span style="color:#808080;font-size:13px">({{supportId}})</span></p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_from}}</p>
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.6">{{from}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_title}}</p>
    <p style="margin:0 0 16px 0;font-size:16px;color:#ffffff;line-height:1.6">{{requestTitle}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_contents}}</p>
    <div style="margin:0 0 16px 0;padding:16px;background:#111111;border-radius:8px;border:1px solid #1a1a1a;font-size:15px;color:#e5e5e5;line-height:1.65;white-space:pre-wrap">{{requestContentsHtml}}</div>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_locale}}</p>
    <p style="margin:0 0 16px 0;font-size:14px;color:#b0b0b0;line-height:1.6">{{locale}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_screenshot}}</p>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6;word-break:break-all">{{screenshotNote}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[{{ticketNumber}}] New support request from {{from}}",
        intro: "A new support request was submitted on FrontierBase.",
        label_ticket: "Ticket",
        label_from: "From",
        label_title: "Subject",
        label_contents: "Message",
        label_locale: "Locale",
        label_screenshot: "Screenshot",
      },
    },
  },

  billing_payment_reminder: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_date}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{chargeDateLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_plan}}</p>
    <p style="margin:0 0 24px 0;font-size:16px;color:#e5e5e5;line-height:1.6">{{plan}}</p>
    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[FrontierBase] Payment scheduled for {{chargeDateLabel}}",
        hey_default: "Hello 👋",
        intro:
          "This is a reminder that your FrontierBase subscription payment is scheduled for tomorrow.",
        label_date: "Payment date",
        label_plan: "Plan",
        footer_note:
          "If you need to update your payment method or review your subscription, open billing in the console.",
        cta_open_billing: "Open billing",
      },
      ko: {
        subject: "[FrontierBase] {{chargeDateLabel}} 결제 예정 안내",
        hey_default: "안녕하세요 👋",
        intro:
          "FrontierBase 구독 요금이 내일 결제될 예정임을 안내드립니다.",
        label_date: "결제 예정일",
        label_plan: "플랜",
        footer_note:
          "결제 수단 변경이나 구독 내역 확인이 필요하면 콘솔의 결제·구독 메뉴를 이용해 주세요.",
        cta_open_billing: "결제·구독 열기",
      },
      ja: {
        subject: "[FrontierBase] {{chargeDateLabel}} のお支払い予定",
        hey_default: "こんにちは 👋",
        intro:
          "FrontierBase のサブスクリプション料金は、明日お支払い予定です。",
        label_date: "お支払い予定日",
        label_plan: "プラン",
        footer_note:
          "お支払い方法の変更や契約内容の確認は、コンソールの請求・契約画面から行えます。",
        cta_open_billing: "請求・契約を開く",
      },
      de: {
        subject: "[FrontierBase] Zahlung geplant am {{chargeDateLabel}}",
        hey_default: "Hallo 👋",
        intro:
          "Ihre FrontierBase-Abonnementzahlung ist für morgen vorgesehen.",
        label_date: "Zahlungsdatum",
        label_plan: "Tarif",
        footer_note:
          "Zahlungsmethode oder Abonnement können Sie in der Konsole unter Abrechnung prüfen.",
        cta_open_billing: "Abrechnung öffnen",
      },
      fr: {
        subject: "[FrontierBase] Paiement prévu le {{chargeDateLabel}}",
        hey_default: "Bonjour 👋",
        intro:
          "Votre paiement d’abonnement FrontierBase est prévu pour demain.",
        label_date: "Date de paiement",
        label_plan: "Offre",
        footer_note:
          "Pour modifier le moyen de paiement ou consulter l’abonnement, ouvrez la facturation dans la console.",
        cta_open_billing: "Ouvrir la facturation",
      },
      it: {
        subject: "[FrontierBase] Pagamento previsto il {{chargeDateLabel}}",
        hey_default: "Ciao 👋",
        intro:
          "Il pagamento del tuo abbonamento FrontierBase è previsto per domani.",
        label_date: "Data di pagamento",
        label_plan: "Piano",
        footer_note:
          "Per aggiornare il metodo di pagamento o rivedere l’abbonamento, apri Fatturazione nella console.",
        cta_open_billing: "Apri fatturazione",
      },
      zh: {
        subject: "[FrontierBase] {{chargeDateLabel}} 將進行扣款",
        hey_default: "你好 👋",
        intro: "您的 FrontierBase 訂閱費用將於明天扣款。",
        label_date: "扣款日期",
        label_plan: "方案",
        footer_note: "如需更新付款方式或查看訂閱，請至控制台的帳單頁面。",
        cta_open_billing: "開啟帳單",
      },
      es: {
        subject: "[FrontierBase] Pago programado para el {{chargeDateLabel}}",
        hey_default: "Hola 👋",
        intro:
          "Tu pago de suscripción de FrontierBase está programado para mañana.",
        label_date: "Fecha de pago",
        label_plan: "Plan",
        footer_note:
          "Para actualizar el método de pago o revisar la suscripción, abre Facturación en la consola.",
        cta_open_billing: "Abrir facturación",
      },
    },
  },

  billing_cancellation_reminder: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_date}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{effectiveDateLabel}}</p>
    <p style="margin:0 0 20px 0;font-size:15px;color:#e5e5e5;line-height:1.65">{{withdraw_note}}</p>
    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[FrontierBase] Subscription ends on {{effectiveDateLabel}}",
        hey_default: "Hello 👋",
        intro:
          "Your FrontierBase subscription is scheduled to cancel tomorrow.\nAfter that date, paid features will no longer be available.",
        label_date: "Cancellation date",
        withdraw_note:
          "If you want to keep your subscription, open Subscription in the console and withdraw the scheduled cancellation before the date above.",
        footer_note:
          "This email was sent because a cancellation is scheduled on your account.",
        cta_open_billing: "Manage subscription",
      },
      ko: {
        subject: "[FrontierBase] {{effectiveDateLabel}} 구독 종료 예정 안내",
        hey_default: "안녕하세요 👋",
        intro:
          "FrontierBase 구독이 내일 종료(취소)될 예정입니다.\n해당 일자 이후에는 유료 기능을 사용할 수 없습니다.",
        label_date: "종료 예정일",
        withdraw_note:
          "구독을 유지하려면 콘솔의 구독 내역에서 취소 예약을 철회해 주세요.",
        footer_note: "취소 예약이 등록된 계정에 안내 메일을 발송했습니다.",
        cta_open_billing: "구독 관리",
      },
      ja: {
        subject: "[FrontierBase] {{effectiveDateLabel}} に解約予定",
        hey_default: "こんにちは 👋",
        intro:
          "FrontierBase のサブスクリプションは、明日解約される予定です。\n以降は有料機能をご利用いただけません。",
        label_date: "解約予定日",
        withdraw_note:
          "継続をご希望の場合は、コンソールの契約画面で解約予約を取り消してください。",
        footer_note: "解約予約が登録されているためお送りしています。",
        cta_open_billing: "契約を管理",
      },
      de: {
        subject: "[FrontierBase] Kündigung am {{effectiveDateLabel}}",
        hey_default: "Hallo 👋",
        intro:
          "Ihr FrontierBase-Abonnement wird morgen beendet.\nDanach stehen kostenpflichtige Funktionen nicht mehr zur Verfügung.",
        label_date: "Kündigungsdatum",
        withdraw_note:
          "Wenn Sie das Abonnement behalten möchten, heben Sie die geplante Kündigung in der Konsole unter Abonnement auf.",
        footer_note: "Diese E-Mail wurde wegen einer geplanten Kündigung gesendet.",
        cta_open_billing: "Abonnement verwalten",
      },
      fr: {
        subject: "[FrontierBase] Fin d’abonnement le {{effectiveDateLabel}}",
        hey_default: "Bonjour 👋",
        intro:
          "Votre abonnement FrontierBase prendra fin demain.\nLes fonctionnalités payantes ne seront plus disponibles ensuite.",
        label_date: "Date de fin",
        withdraw_note:
          "Pour conserver l’abonnement, ouvrez Abonnement dans la console et annulez la résiliation programmée.",
        footer_note: "E-mail envoyé car une résiliation est programmée.",
        cta_open_billing: "Gérer l’abonnement",
      },
      it: {
        subject: "[FrontierBase] Disdetta il {{effectiveDateLabel}}",
        hey_default: "Ciao 👋",
        intro:
          "Il tuo abbonamento FrontierBase terminerà domani.\nDopo quella data le funzioni a pagamento non saranno più disponibili.",
        label_date: "Data di disdetta",
        withdraw_note:
          "Per mantenere l’abbonamento, apri Abbonamento nella console e revoca la disdetta programmata.",
        footer_note: "Email inviata perché è programmata una disdetta.",
        cta_open_billing: "Gestisci abbonamento",
      },
      zh: {
        subject: "[FrontierBase] {{effectiveDateLabel}} 將取消訂閱",
        hey_default: "你好 👋",
        intro:
          "您的 FrontierBase 訂閱將於明天取消。\n之後將無法使用付費功能。",
        label_date: "取消日期",
        withdraw_note:
          "若需保留訂閱，請至控制台的訂閱頁面撤回已預約的取消。",
        footer_note: "此信因帳戶已預約取消而寄出。",
        cta_open_billing: "管理訂閱",
      },
      es: {
        subject: "[FrontierBase] Cancelación el {{effectiveDateLabel}}",
        hey_default: "Hola 👋",
        intro:
          "Tu suscripción de FrontierBase se cancelará mañana.\nDespués de esa fecha no podrás usar las funciones de pago.",
        label_date: "Fecha de cancelación",
        withdraw_note:
          "Si quieres mantener la suscripción, abre Suscripción en la consola y retira la cancelación programada.",
        footer_note: "Este correo se envió porque hay una cancelación programada.",
        cta_open_billing: "Gestionar suscripción",
      },
    },
  },

  token_low_reminder: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_remaining}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{remainingPercentLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_plan}}</p>
    <p style="margin:0 0 24px 0;font-size:16px;color:#e5e5e5;line-height:1.6">{{plan}}</p>
    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[FrontierBase] Token balance below {{thresholdPercentLabel}} ({{remainingPercentLabel}} remaining)",
        hey_default: "Hello 👋",
        intro:
          "Your FrontierBase token balance for this billing period has dropped below {{thresholdPercentLabel}}.\nCurrent remaining: {{remainingPercentLabel}}.",
        label_remaining: "Remaining",
        label_plan: "Plan",
        footer_note:
          "To avoid service interruption, consider upgrading your plan or purchasing a token pack in the console.",
        cta_open_billing: "Open billing",
      },
      ko: {
        subject: "[FrontierBase] 토큰 잔량 {{thresholdPercentLabel}} 미만 ({{remainingPercentLabel}} 남음)",
        hey_default: "안녕하세요 👋",
        intro:
          "이번 빌링 주기의 FrontierBase 토큰 잔량이 {{thresholdPercentLabel}} 미만으로 떨어졌습니다.\n현재 잔량: {{remainingPercentLabel}}.",
        label_remaining: "잔량",
        label_plan: "플랜",
        footer_note:
          "서비스 중단을 피하려면 콘솔에서 플랜을 업그레이드하거나 토큰팩을 구매해 주세요.",
        cta_open_billing: "결제·구독 열기",
      },
      ja: {
        subject: "[FrontierBase] トークン残量が {{thresholdPercentLabel}} 未満（残り {{remainingPercentLabel}}）",
        hey_default: "こんにちは 👋",
        intro:
          "今請求期間の FrontierBase トークン残量が {{thresholdPercentLabel}} 未満になりました。\n現在の残量: {{remainingPercentLabel}}。",
        label_remaining: "残量",
        label_plan: "プラン",
        footer_note:
          "サービス停止を避けるため、コンソールでプランのアップグレードまたはトークンパックの購入をご検討ください。",
        cta_open_billing: "請求・契約を開く",
      },
      de: {
        subject: "[FrontierBase] Token-Guthaben unter {{thresholdPercentLabel}} ({{remainingPercentLabel}} übrig)",
        hey_default: "Hallo 👋",
        intro:
          "Ihr FrontierBase-Token-Guthaben für diesen Abrechnungszeitraum ist unter {{thresholdPercentLabel}} gefallen.\nAktuell übrig: {{remainingPercentLabel}}.",
        label_remaining: "Übrig",
        label_plan: "Tarif",
        footer_note:
          "Um Unterbrechungen zu vermeiden, upgraden Sie Ihren Tarif oder kaufen Sie ein Token-Paket in der Konsole.",
        cta_open_billing: "Abrechnung öffnen",
      },
      fr: {
        subject: "[FrontierBase] Solde sous {{thresholdPercentLabel}} ({{remainingPercentLabel}} restants)",
        hey_default: "Bonjour 👋",
        intro:
          "Votre solde de jetons FrontierBase pour cette période de facturation est passé sous {{thresholdPercentLabel}}.\nReste actuel : {{remainingPercentLabel}}.",
        label_remaining: "Reste",
        label_plan: "Offre",
        footer_note:
          "Pour éviter une interruption, envisagez de passer à une offre supérieure ou d’acheter un pack de jetons dans la console.",
        cta_open_billing: "Ouvrir la facturation",
      },
      it: {
        subject: "[FrontierBase] Saldo sotto {{thresholdPercentLabel}} ({{remainingPercentLabel}} rimanenti)",
        hey_default: "Ciao 👋",
        intro:
          "Il saldo token FrontierBase di questo periodo di fatturazione è sceso sotto {{thresholdPercentLabel}}.\nRimanenti: {{remainingPercentLabel}}.",
        label_remaining: "Rimanenti",
        label_plan: "Piano",
        footer_note:
          "Per evitare interruzioni, valuta un upgrade del piano o l’acquisto di un pacchetto token nella console.",
        cta_open_billing: "Apri fatturazione",
      },
      zh: {
        subject: "[FrontierBase] 權杖餘額低於 {{thresholdPercentLabel}}（剩餘 {{remainingPercentLabel}}）",
        hey_default: "你好 👋",
        intro:
          "本計費週期的 FrontierBase 權杖餘額已低於 {{thresholdPercentLabel}}。\n目前剩餘：{{remainingPercentLabel}}。",
        label_remaining: "剩餘",
        label_plan: "方案",
        footer_note: "為避免服務中斷，請至控制台升級方案或購買權杖包。",
        cta_open_billing: "開啟帳單",
      },
      es: {
        subject: "[FrontierBase] Saldo bajo {{thresholdPercentLabel}} ({{remainingPercentLabel}} restante)",
        hey_default: "Hola 👋",
        intro:
          "Tu saldo de tokens de FrontierBase de este periodo de facturación ha bajado de {{thresholdPercentLabel}}.\nRestante actual: {{remainingPercentLabel}}.",
        label_remaining: "Restante",
        label_plan: "Plan",
        footer_note:
          "Para evitar interrupciones, considera mejorar el plan o comprar un paquete de tokens en la consola.",
        cta_open_billing: "Abrir facturación",
      },
    },
  },

  password_reset: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
        <tbody>
          <tr>
            <td style="padding:16px 12px">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
              <tbody>
                <tr>
                  <td align="center" style="padding:40px 32px 24px">
                    <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                  </td>
                </tr>
                <tr style="text-align:center">
                  <td style="padding:0 32px 40px">
                    <p style="margin:0 0 20px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{hey}}</p>
                    <p style="margin:0 0 24px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{body}}</p>
                    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
                    <p style="margin:0 0 20px 0;line-height:1.65;color:#b0b0b0;font-size:14px">{{disclaimer}}</p>
                    <p style="margin:0;line-height:1.65;color:#808080;font-size:14px">{{thanks}}</p>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody><tr><td style="padding:24px 0 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            </td>
          </tr>
        </tbody>
      </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        subject: "Reset your FrontierBase password",
        hey_default: "Hello,",
        body: "Follow the link below to reset your **FrontierBase** password for your {{email}} account.",
        cta_reset: "Reset password",
        disclaimer: "If you didn't ask to reset your password, you can ignore this email.",
        thanks: "Thanks,\nYour FrontierBase team",
      },
      ko: {
        subject: "FrontierBase 비밀번호 재설정",
        hey_default: "안녕하세요,",
        body: "아래 링크를 통해 **FrontierBase** 계정({{email}})의 비밀번호를 재설정할 수 있습니다.",
        cta_reset: "비밀번호 재설정",
        disclaimer: "비밀번호 재설정을 요청하지 않으셨다면 이 이메일은 무시하셔도 됩니다.",
        thanks: "감사합니다.\nFrontierBase 팀 드림",
      },
      ja: {
        subject: "FrontierBase パスワードの再設定",
        hey_default: "こんにちは、",
        body: "以下のリンクから、{{email}} アカウントの **FrontierBase** パスワードを再設定できます。",
        cta_reset: "パスワードを再設定",
        disclaimer: "再設定を依頼していない場合は、このメールは無視してください。",
        thanks: "よろしくお願いいたします。\nFrontierBase チーム",
      },
      de: {
        subject: "FrontierBase-Passwort zurücksetzen",
        hey_default: "Hallo,",
        body: "Folgen Sie dem Link unten, um Ihr **FrontierBase**-Passwort für das Konto {{email}} zurückzusetzen.",
        cta_reset: "Passwort zurücksetzen",
        disclaimer: "Wenn Sie kein Zurücksetzen angefordert haben, können Sie diese E-Mail ignorieren.",
        thanks: "Vielen Dank,\nIhr FrontierBase-Team",
      },
      fr: {
        subject: "Réinitialisez votre mot de passe FrontierBase",
        hey_default: "Bonjour,",
        body: "Suivez le lien ci-dessous pour réinitialiser votre mot de passe **FrontierBase** pour le compte {{email}}.",
        cta_reset: "Réinitialiser le mot de passe",
        disclaimer: "Si vous n’avez pas demandé de réinitialisation, vous pouvez ignorer cet e-mail.",
        thanks: "Merci,\nL’équipe FrontierBase",
      },
      it: {
        subject: "Reimposta la password FrontierBase",
        hey_default: "Ciao,",
        body: "Segui il link qui sotto per reimpostare la password **FrontierBase** dell’account {{email}}.",
        cta_reset: "Reimposta password",
        disclaimer: "Se non hai richiesto la reimpostazione, puoi ignorare questa email.",
        thanks: "Grazie,\nIl team FrontierBase",
      },
      zh: {
        subject: "重設您的 FrontierBase 密碼",
        hey_default: "您好，",
        body: "請點選下方連結，重設 **FrontierBase** 帳戶（{{email}}）的密碼。",
        cta_reset: "重設密碼",
        disclaimer: "若您未要求重設密碼，可忽略此郵件。",
        thanks: "謝謝，\nFrontierBase 團隊",
      },
      es: {
        subject: "Restablece tu contraseña de FrontierBase",
        hey_default: "Hola,",
        body: "Sigue el enlace de abajo para restablecer tu contraseña de **FrontierBase** de la cuenta {{email}}.",
        cta_reset: "Restablecer contraseña",
        disclaimer: "Si no solicitaste restablecer la contraseña, puedes ignorar este correo.",
        thanks: "Gracias,\nEl equipo de FrontierBase",
      },
    },
  },

  email_login_otp: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000" width="100%">
  <tbody>
    <tr>
      <td align="center" style="padding:0">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto" width="100%">
        <tbody>
          <tr>
            <td style="padding:16px 12px">
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#0a0a0a;border-radius:16px;overflow:hidden" width="100%">
              <tbody>
                <tr>
                  <td align="center" style="padding:40px 32px 24px">
                    <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="50" height="50" style="display:block;width:50px;height:50px;border:0" />
                  </td>
                </tr>
                <tr style="text-align:center">
                  <td style="padding:0 32px 40px">
                    <p style="margin:0 0 24px 0;line-height:1.7;color:#e5e5e5;font-size:16px">{{intro}}</p>
                    <p style="margin:0 0 24px 0;font-size:28px;font-weight:700;letter-spacing:4px;color:#ffffff">{{code}}</p>
                    <p style="margin:0;line-height:1.65;color:#b0b0b0;font-size:14px">{{disclaimer}}</p>
                    <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
                      <tbody><tr><td style="padding:24px 0 0"><div style="height:1px;background-color:#1a1a1a">&nbsp;</div></td></tr></tbody>
                    </table>
                    <p style="margin:24px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
                  </td>
                </tr>
              </tbody>
            </table>
            </td>
          </tr>
        </tbody>
      </table>
      </td>
    </tr>
  </tbody>
</table>
</div>`,
    strings: {
      en: {
        subject: "{{label}} login code",
        intro: "Your {{label}} login verification code:",
        disclaimer:
          "This code expires in {{ttlMin}} minutes. If you did not request this, ignore this email.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase Admin",
      },
      ko: {
        subject: "{{label}} 인증 코드",
        intro: "{{label}} 로그인 인증 코드입니다.",
        disclaimer:
          "코드는 {{ttlMin}}분간 유효합니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase 관리자",
      },
      ja: {
        subject: "{{label}} ログイン認証コード",
        intro: "{{label}} のログイン認証コードです。",
        disclaimer:
          "このコードの有効期限は {{ttlMin}} 分です。心当たりがない場合は、このメールを無視してください。",
        label_console: "FrontierBase",
        label_admin: "FrontierBase 管理",
      },
      de: {
        subject: "{{label}} Anmeldecode",
        intro: "Ihr {{label}} Anmeldebestätigungscode:",
        disclaimer:
          "Dieser Code ist {{ttlMin}} Minuten gültig. Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase Admin",
      },
      fr: {
        subject: "Code de connexion {{label}}",
        intro: "Votre code de vérification de connexion {{label}} :",
        disclaimer:
          "Ce code expire dans {{ttlMin}} minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase Admin",
      },
      it: {
        subject: "Codice di accesso {{label}}",
        intro: "Il tuo codice di verifica per l’accesso a {{label}}:",
        disclaimer:
          "Questo codice scade tra {{ttlMin}} minuti. Se non hai richiesto il codice, ignora questa email.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase Admin",
      },
      zh: {
        subject: "{{label}} 登入驗證碼",
        intro: "您的 {{label}} 登入驗證碼：",
        disclaimer:
          "此驗證碼將在 {{ttlMin}} 分鐘後失效。若您未提出此請求，請忽略此郵件。",
        label_console: "FrontierBase",
        label_admin: "FrontierBase 管理後台",
      },
      es: {
        subject: "Código de acceso de {{label}}",
        intro: "Tu código de verificación de acceso a {{label}}:",
        disclaimer:
          "Este código caduca en {{ttlMin}} minutos. Si no lo solicitaste, ignora este correo.",
        label_console: "FrontierBase",
        label_admin: "FrontierBase Admin",
      },
    },
  },

  response_summary: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_date}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{dateLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_messages}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{messageTotalLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_question_types}}</p>
    <div style="margin:0 0 8px 0">{{questionTypesHtml}}</div>
    <p style="margin:0 0 24px 0;font-size:13px;color:#808080;line-height:1.5">{{moreTypesNote}}</p>
    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[FrontierBase] Daily response summary — {{dateLabel}}",
        hey_default: "Hello 👋",
        intro: "Here is your FrontierBase response summary for the previous UTC day.",
        label_date: "Date",
        label_messages: "Messages",
        label_question_types: "Question types (top)",
        more_types: "+{{moreTypesLabel}} more types in console",
        footer_note: "Open the console for full analytics.",
        cta_open_analytics: "Open console",
      },
      ko: {
        subject: "[FrontierBase] 일일 응답 요약 — {{dateLabel}}",
        hey_default: "안녕하세요 👋",
        intro: "이전 UTC 일 기준 FrontierBase 응답(대화) 요약입니다.",
        label_date: "날짜",
        label_messages: "메시지 수",
        label_question_types: "질문 유형 (상위)",
        more_types: "외 {{moreTypesLabel}}개 유형은 콘솔에서 확인",
        footer_note: "자세한 분석은 콘솔에서 확인할 수 있습니다.",
        cta_open_analytics: "콘솔 열기",
      },
      ja: {
        subject: "[FrontierBase] 日次レスポンス要約 — {{dateLabel}}",
        hey_default: "こんにちは 👋",
        intro: "直前の UTC 日の FrontierBase レスポンス要約です。",
        label_date: "日付",
        label_messages: "メッセージ数",
        label_question_types: "質問タイプ（上位）",
        more_types: "他 {{moreTypesLabel}} タイプはコンソールで確認",
        footer_note: "詳細な分析はコンソールで確認できます。",
        cta_open_analytics: "コンソールを開く",
      },
      de: {
        subject: "[FrontierBase] Tägliche Antwort-Zusammenfassung — {{dateLabel}}",
        hey_default: "Hallo 👋",
        intro: "Hier ist Ihre FrontierBase-Antwortzusammenfassung für den vorherigen UTC-Tag.",
        label_date: "Datum",
        label_messages: "Nachrichten",
        label_question_types: "Fragetypen (Top)",
        more_types: "+{{moreTypesLabel}} weitere Typen in der Konsole",
        footer_note: "Vollständige Analysen finden Sie in der Konsole.",
        cta_open_analytics: "Konsole öffnen",
      },
      fr: {
        subject: "[FrontierBase] Résumé quotidien des réponses — {{dateLabel}}",
        hey_default: "Bonjour 👋",
        intro: "Voici le résumé des réponses FrontierBase pour le jour UTC précédent.",
        label_date: "Date",
        label_messages: "Messages",
        label_question_types: "Types de questions (top)",
        more_types: "+{{moreTypesLabel}} autres types dans la console",
        footer_note: "Ouvrez la console pour les analyses complètes.",
        cta_open_analytics: "Ouvrir la console",
      },
      it: {
        subject: "[FrontierBase] Riepilogo giornaliero risposte — {{dateLabel}}",
        hey_default: "Ciao 👋",
        intro: "Ecco il riepilogo delle risposte FrontierBase del giorno UTC precedente.",
        label_date: "Data",
        label_messages: "Messaggi",
        label_question_types: "Tipi di domanda (top)",
        more_types: "+{{moreTypesLabel}} altri tipi nella console",
        footer_note: "Apri la console per le analisi complete.",
        cta_open_analytics: "Apri console",
      },
      zh: {
        subject: "[FrontierBase] 每日回應摘要 — {{dateLabel}}",
        hey_default: "你好 👋",
        intro: "以下是前一個 UTC 日的 FrontierBase 回應摘要。",
        label_date: "日期",
        label_messages: "訊息數",
        label_question_types: "問題類型（前幾名）",
        more_types: "另有 {{moreTypesLabel}} 種類型請至控制台查看",
        footer_note: "完整分析請至控制台查看。",
        cta_open_analytics: "開啟控制台",
      },
      es: {
        subject: "[FrontierBase] Resumen diario de respuestas — {{dateLabel}}",
        hey_default: "Hola 👋",
        intro: "Aquí tienes el resumen de respuestas de FrontierBase del día UTC anterior.",
        label_date: "Fecha",
        label_messages: "Mensajes",
        label_question_types: "Tipos de pregunta (top)",
        more_types: "+{{moreTypesLabel}} tipos más en la consola",
        footer_note: "Abre la consola para el análisis completo.",
        cta_open_analytics: "Abrir consola",
      },
    },
  },

  unanswered_summary: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#000000;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#000000;max-width:640px;margin:0 auto" width="100%">
  <tr><td style="padding:24px;background:#0a0a0a;border-radius:16px">
    <p style="margin:0 0 16px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{hey}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#e5e5e5;line-height:1.7">{{intro}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_date}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{dateLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_total}}</p>
    <p style="margin:0 0 20px 0;font-size:16px;color:#ffffff;line-height:1.6">{{totalCountLabel}}</p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#808080;text-transform:uppercase;letter-spacing:0.04em">{{label_questions}}</p>
    <div style="margin:0 0 8px 0">{{itemsHtml}}</div>
    <p style="margin:0 0 24px 0;font-size:13px;color:#808080;line-height:1.5">{{moreCountNote}}</p>
    <div style="margin:0 0 24px 0">{{ctaHtml}}</div>
    <p style="margin:0;font-size:14px;color:#b0b0b0;line-height:1.6">{{footer_note}}</p>
    <p style="margin:16px 0 0 0;font-size:12px;color:#808080">©{{year}} HADFAMILY Inc.</p>
  </td></tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[FrontierBase] Daily unanswered summary — {{dateLabel}} ({{totalCountLabel}})",
        hey_default: "Hello 👋",
        intro: "Here is your FrontierBase unanswered-question summary for the previous UTC day.",
        label_date: "Date",
        label_total: "Unanswered total",
        label_questions: "Recent questions",
        more_count: "+{{moreCountLabel}} more in console (showing {{listedCountLabel}})",
        footer_note: "Review unanswered questions in the console to improve your knowledge base.",
        cta_open_analytics: "Open console",
      },
      ko: {
        subject: "[FrontierBase] 일일 미답변 요약 — {{dateLabel}} ({{totalCountLabel}}건)",
        hey_default: "안녕하세요 👋",
        intro: "이전 UTC 일 기준 FrontierBase 미답변 질문 요약입니다.",
        label_date: "날짜",
        label_total: "미답변 총건수",
        label_questions: "최근 질문",
        more_count: "외 {{moreCountLabel}}건은 콘솔에서 확인 (본문 {{listedCountLabel}}건)",
        footer_note: "콘솔에서 미답변을 검토해 지식 베이스를 개선해 보세요.",
        cta_open_analytics: "콘솔 열기",
      },
      ja: {
        subject: "[FrontierBase] 日次未回答要約 — {{dateLabel}}（{{totalCountLabel}}件）",
        hey_default: "こんにちは 👋",
        intro: "直前の UTC 日の FrontierBase 未回答質問の要約です。",
        label_date: "日付",
        label_total: "未回答合計",
        label_questions: "直近の質問",
        more_count: "他 {{moreCountLabel}} 件はコンソールで確認（本文 {{listedCountLabel}} 件）",
        footer_note: "コンソールで未回答を確認し、ナレッジベースを改善してください。",
        cta_open_analytics: "コンソールを開く",
      },
      de: {
        subject: "[FrontierBase] Tägliche Unbeantwortet-Zusammenfassung — {{dateLabel}} ({{totalCountLabel}})",
        hey_default: "Hallo 👋",
        intro: "Hier ist Ihre FrontierBase-Zusammenfassung unbeantworteter Fragen für den vorherigen UTC-Tag.",
        label_date: "Datum",
        label_total: "Unbeantwortet gesamt",
        label_questions: "Aktuelle Fragen",
        more_count: "+{{moreCountLabel}} weitere in der Konsole ({{listedCountLabel}} angezeigt)",
        footer_note: "Prüfen Sie unbeantwortete Fragen in der Konsole, um Ihre Wissensbasis zu verbessern.",
        cta_open_analytics: "Konsole öffnen",
      },
      fr: {
        subject: "[FrontierBase] Résumé quotidien des sans réponse — {{dateLabel}} ({{totalCountLabel}})",
        hey_default: "Bonjour 👋",
        intro: "Voici le résumé des questions sans réponse FrontierBase pour le jour UTC précédent.",
        label_date: "Date",
        label_total: "Total sans réponse",
        label_questions: "Questions récentes",
        more_count: "+{{moreCountLabel}} de plus dans la console ({{listedCountLabel}} affichées)",
        footer_note: "Consultez les questions sans réponse dans la console pour améliorer votre base de connaissances.",
        cta_open_analytics: "Ouvrir la console",
      },
      it: {
        subject: "[FrontierBase] Riepilogo giornaliero senza risposta — {{dateLabel}} ({{totalCountLabel}})",
        hey_default: "Ciao 👋",
        intro: "Ecco il riepilogo delle domande senza risposta FrontierBase del giorno UTC precedente.",
        label_date: "Data",
        label_total: "Totale senza risposta",
        label_questions: "Domande recenti",
        more_count: "+{{moreCountLabel}} altre in console (mostrate {{listedCountLabel}})",
        footer_note: "Rivedi le domande senza risposta in console per migliorare la knowledge base.",
        cta_open_analytics: "Apri console",
      },
      zh: {
        subject: "[FrontierBase] 每日未回答摘要 — {{dateLabel}}（{{totalCountLabel}}）",
        hey_default: "你好 👋",
        intro: "以下是前一個 UTC 日的 FrontierBase 未回答問題摘要。",
        label_date: "日期",
        label_total: "未回答總數",
        label_questions: "近期問題",
        more_count: "另有 {{moreCountLabel}} 筆請至控制台查看（本文 {{listedCountLabel}} 筆）",
        footer_note: "請在控制台檢視未回答問題，以改善知識庫。",
        cta_open_analytics: "開啟控制台",
      },
      es: {
        subject: "[FrontierBase] Resumen diario sin respuesta — {{dateLabel}} ({{totalCountLabel}})",
        hey_default: "Hola 👋",
        intro: "Aquí tienes el resumen de preguntas sin respuesta de FrontierBase del día UTC anterior.",
        label_date: "Fecha",
        label_total: "Total sin respuesta",
        label_questions: "Preguntas recientes",
        more_count: "+{{moreCountLabel}} más en la consola (mostrando {{listedCountLabel}})",
        footer_note: "Revisa las preguntas sin respuesta en la consola para mejorar tu base de conocimiento.",
        cta_open_analytics: "Abrir consola",
      },
    },
  },

  issue_track_user_confirmation: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#f7f7f8;color:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f7f7f8" width="100%">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;margin:0 auto;background-color:#ffffff;border:1px solid #ececec;border-radius:12px" width="100%">
        <tr>
          <td style="padding:36px 32px 28px">
            <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="36" height="36" style="display:block;width:36px;height:36px;border:0;margin:0 0 24px 0" />
            <p style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0d0d0d;line-height:1.4">{{hey}}</p>
            <p style="margin:0 0 28px 0;font-size:15px;color:#353740;line-height:1.7">{{intro}}</p>
            <p style="margin:0 0 6px 0;font-size:12px;font-weight:500;color:#6e6e80;letter-spacing:0.02em">{{label_issue}}</p>
            <p style="margin:0 0 24px 0;font-size:16px;font-weight:600;color:#0d0d0d;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace">{{issueNumber}}</p>
            <p style="margin:0 0 8px 0;font-size:12px;font-weight:500;color:#6e6e80;letter-spacing:0.02em">{{label_question}}</p>
            <div style="margin:0 0 28px 0;padding:16px 18px;background:#f7f7f8;border-radius:8px;border:1px solid #ececec;font-size:14px;color:#353740;line-height:1.65;white-space:pre-wrap">{{questionHtml}}</div>
            <p style="margin:0 0 24px 0;font-size:14px;color:#6e6e80;line-height:1.6">{{footer_note}}</p>
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr><td style="border-top:1px solid #ececec;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>
            <p style="margin:20px 0 0 0;font-size:12px;color:#8e8ea0;line-height:1.5">©{{year}} HADFAMILY Inc.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[{{issueNumber}}] Your support request was received",
        hey_default: "Hello",
        intro:
          "Escalated to a support specialist. You can expect a response in the coming days. Replies will also be sent via email.",
        label_issue: "Issue number",
        label_question: "Your question",
        footer_note: "You can add additional comments in the chat if needed.",
      },
      ko: {
        subject: "[{{issueNumber}}] 문의가 접수되었습니다",
        hey_default: "안녕하세요",
        intro:
          "담당 지원 스페셜리스트에게 전달되었습니다. 며칠 내 답변을 받으실 수 있으며, 회신도 이메일로 발송됩니다.",
        label_issue: "이슈 번호",
        label_question: "문의 내용",
        footer_note: "필요하면 채팅에서 추가 내용을 남겨 주세요.",
      },
      ja: {
        subject: "[{{issueNumber}}] お問い合わせを受け付けました",
        hey_default: "こんにちは",
        intro:
          "サポート担当者にエスカレーションしました。近日中にご連絡します。返信もメールでお送りします。",
        label_issue: "課題番号",
        label_question: "お問い合わせ内容",
        footer_note: "必要に応じてチャットに追加コメントを残せます。",
      },
      de: {
        subject: "[{{issueNumber}}] Ihre Anfrage wurde empfangen",
        hey_default: "Hallo",
        intro:
          "An einen Support-Spezialisten eskaliert. Sie erhalten in den kommenden Tagen eine Antwort per E-Mail.",
        label_issue: "Ticketnummer",
        label_question: "Ihre Frage",
        footer_note: "Sie können im Chat weitere Kommentare hinzufügen.",
      },
      fr: {
        subject: "[{{issueNumber}}] Votre demande a été reçue",
        hey_default: "Bonjour",
        intro:
          "Transmis à un spécialiste du support. Une réponse vous sera envoyée sous peu par e-mail.",
        label_issue: "Numéro de ticket",
        label_question: "Votre question",
        footer_note: "Vous pouvez ajouter des commentaires dans le chat si besoin.",
      },
      it: {
        subject: "[{{issueNumber}}] Richiesta ricevuta",
        hey_default: "Ciao",
        intro:
          "Inoltrato a uno specialista del supporto. Riceverai una risposta nei prossimi giorni anche via email.",
        label_issue: "Numero ticket",
        label_question: "La tua domanda",
        footer_note: "Puoi aggiungere altri commenti nella chat se necessario.",
      },
      zh: {
        subject: "[{{issueNumber}}] 已收到您的支援請求",
        hey_default: "您好",
        intro: "已轉交支援專員。預計數日內回覆，並會以電子郵件通知。",
        label_issue: "工單編號",
        label_question: "您的問題",
        footer_note: "如有需要，可在聊天中補充說明。",
      },
      es: {
        subject: "[{{issueNumber}}] Hemos recibido tu solicitud",
        hey_default: "Hola",
        intro:
          "Escalado a un especialista de soporte. Recibirás una respuesta en los próximos días por correo.",
        label_issue: "Número de incidencia",
        label_question: "Tu pregunta",
        footer_note: "Puedes añadir comentarios adicionales en el chat si lo necesitas.",
      },
    },
  },

  issue_track_admin_notification: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#f7f7f8;color:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f7f7f8" width="100%">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;width:100%;margin:0 auto;background-color:#ffffff;border:1px solid #ececec;border-radius:12px" width="100%">
        <tr>
          <td style="padding:36px 32px 28px">
            <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="36" height="36" style="display:block;width:36px;height:36px;border:0;margin:0 0 24px 0" />
            <p style="margin:0 0 24px 0;font-size:15px;color:#353740;line-height:1.7">{{intro}}</p>
            <p style="margin:0 0 4px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_issue}}</p>
            <p style="margin:0 0 16px 0;font-size:15px;font-weight:600;color:#0d0d0d;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace">{{issueNumber}}</p>
            <p style="margin:0 0 4px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_contact}}</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#0d0d0d">{{contactEmail}}</p>
            <p style="margin:0 0 4px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_tenant}}</p>
            <p style="margin:0 0 16px 0;font-size:15px;color:#0d0d0d">{{tenantId}}</p>
            <p style="margin:0 0 4px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_conversation}}</p>
            <p style="margin:0 0 20px 0;font-size:15px;color:#0d0d0d;word-break:break-all">{{conversationId}}</p>
            <p style="margin:0 0 8px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_question}}</p>
            <div style="margin:0 0 20px 0;padding:16px 18px;background:#f7f7f8;border-radius:8px;border:1px solid #ececec;font-size:14px;color:#353740;line-height:1.65;white-space:pre-wrap">{{questionHtml}}</div>
            <p style="margin:0 0 8px 0;font-size:12px;font-weight:500;color:#6e6e80">{{label_transcript}}</p>
            <div style="margin:0 0 24px 0;padding:16px 18px;background:#f7f7f8;border-radius:8px;border:1px solid #ececec;font-size:13px;color:#353740;line-height:1.6;white-space:pre-wrap">{{transcriptHtml}}</div>
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr><td style="border-top:1px solid #ececec;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>
            <p style="margin:20px 0 0 0;font-size:12px;color:#8e8ea0;line-height:1.5">©{{year}} HADFAMILY Inc.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`,
    strings: {
      en: {
        subject: "[Issue Track {{issueNumber}}] New escalation from {{contactEmail}}",
        intro: "A chat user requested human follow-up via Issue Track.",
        label_issue: "Issue number",
        label_contact: "Requester email",
        label_tenant: "Tenant",
        label_conversation: "Conversation",
        label_question: "Trigger question",
        label_transcript: "Conversation transcript",
      },
      ko: {
        subject: "[이슈 트랙 {{issueNumber}}] 새 에스컬레이션 — {{contactEmail}}",
        intro: "채팅 사용자가 이슈 트랙으로 담당자 연락을 요청했습니다.",
        label_issue: "이슈 번호",
        label_contact: "요청자 이메일",
        label_tenant: "테넌트",
        label_conversation: "대화 ID",
        label_question: "트리거 질문",
        label_transcript: "대화 내용",
      },
      ja: {
        subject: "[イシュートラック {{issueNumber}}] 新しいエスカレーション — {{contactEmail}}",
        intro: "チャットユーザーがイシュートラックで担当者対応を依頼しました。",
        label_issue: "課題番号",
        label_contact: "依頼者メール",
        label_tenant: "テナント",
        label_conversation: "会話 ID",
        label_question: "トリガー質問",
        label_transcript: "会話内容",
      },
      de: {
        subject: "[Issue-Track {{issueNumber}}] Neue Eskalation von {{contactEmail}}",
        intro: "Ein Chat-Nutzer hat über Issue-Track eine menschliche Nachverfolgung angefordert.",
        label_issue: "Ticketnummer",
        label_contact: "Anfrage-E-Mail",
        label_tenant: "Mandant",
        label_conversation: "Gespräch",
        label_question: "Auslöserfrage",
        label_transcript: "Gesprächsverlauf",
      },
      fr: {
        subject: "[Suivi des tickets {{issueNumber}}] Nouvelle escalation — {{contactEmail}}",
        intro: "Un utilisateur du chat a demandé un suivi humain via le suivi des tickets.",
        label_issue: "Numéro de ticket",
        label_contact: "E-mail du demandeur",
        label_tenant: "Locataire",
        label_conversation: "Conversation",
        label_question: "Question déclencheuse",
        label_transcript: "Transcription",
      },
      it: {
        subject: "[Tracciamento ticket {{issueNumber}}] Nuova escalation — {{contactEmail}}",
        intro: "Un utente della chat ha richiesto un follow-up umano tramite tracciamento ticket.",
        label_issue: "Numero ticket",
        label_contact: "Email richiedente",
        label_tenant: "Tenant",
        label_conversation: "Conversazione",
        label_question: "Domanda",
        label_transcript: "Trascrizione",
      },
      zh: {
        subject: "[工單追蹤 {{issueNumber}}] 新升級 — {{contactEmail}}",
        intro: "聊天使用者透過工單追蹤請求人工跟進。",
        label_issue: "工單編號",
        label_contact: "請求者信箱",
        label_tenant: "租戶",
        label_conversation: "對話",
        label_question: "觸發問題",
        label_transcript: "對話內容",
      },
      es: {
        subject: "[Seguimiento {{issueNumber}}] Nueva escalación — {{contactEmail}}",
        intro: "Un usuario del chat solicitó seguimiento humano vía seguimiento de incidencias.",
        label_issue: "Número de incidencia",
        label_contact: "Email del solicitante",
        label_tenant: "Inquilino",
        label_conversation: "Conversación",
        label_question: "Pregunta",
        label_transcript: "Transcripción",
      },
    },
  },

  issue_track_reply: {
    bodyHtml: `<div style="margin:0;padding:0;width:100%;background-color:#f7f7f8;color:#0d0d0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f7f7f8" width="100%">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table border="0" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;margin:0 auto;background-color:#ffffff;border:1px solid #ececec;border-radius:12px" width="100%">
        <tr>
          <td style="padding:36px 32px 28px">
            <img src="https://www.frontierbase.io/favicon-96x96.png" alt="FrontierBase" width="36" height="36" style="display:block;width:36px;height:36px;border:0;margin:0 0 24px 0" />
            <p style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0d0d0d;line-height:1.4">{{hey}}</p>
            <p style="margin:0 0 20px 0;font-size:13px;color:#6e6e80;line-height:1.5">{{label_issue}}: <span style="color:#0d0d0d;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace">{{issueNumber}}</span></p>
            <div style="margin:0 0 28px 0;padding:16px 18px;background:#f7f7f8;border-radius:8px;border:1px solid #ececec;font-size:15px;color:#353740;line-height:1.7;white-space:pre-wrap">{{bodyHtml}}</div>
            <table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%"><tr><td style="border-top:1px solid #ececec;font-size:0;line-height:0;height:1px">&nbsp;</td></tr></table>
            <p style="margin:20px 0 0 0;font-size:12px;color:#8e8ea0;line-height:1.5">©{{year}} HADFAMILY Inc.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`,
    strings: {
      en: {
        // 콘솔이 [RE][ISS-…] … 형태로 전체 제목을 넘김 → issueNumber를 다시 붙이지 않음
        subject: "{{replySubject}}",
        hey_default: "Hello",
        label_issue: "Issue",
        default_reply_subject: "Update",
      },
      ko: {
        subject: "{{replySubject}}",
        hey_default: "안녕하세요",
        label_issue: "이슈",
        default_reply_subject: "업데이트",
      },
      ja: {
        subject: "{{replySubject}}",
        hey_default: "こんにちは",
        label_issue: "課題",
        default_reply_subject: "更新",
      },
      de: {
        subject: "{{replySubject}}",
        hey_default: "Hallo",
        label_issue: "Ticket",
        default_reply_subject: "Update",
      },
      fr: {
        subject: "{{replySubject}}",
        hey_default: "Bonjour",
        label_issue: "Ticket",
        default_reply_subject: "Mise à jour",
      },
      it: {
        subject: "{{replySubject}}",
        hey_default: "Ciao",
        label_issue: "Ticket",
        default_reply_subject: "Aggiornamento",
      },
      zh: {
        subject: "{{replySubject}}",
        hey_default: "您好",
        label_issue: "工單",
        default_reply_subject: "更新",
      },
      es: {
        subject: "{{replySubject}}",
        hey_default: "Hola",
        label_issue: "Incidencia",
        default_reply_subject: "Actualización",
      },
    },
  },
};

module.exports = { EMAIL_TEMPLATE_BUNDLES };