<template>
  <div class="chatbot-guide">
    <h1 class="page-title">{{ t('nav.chatbot') }}</h1>

    <!-- In-page TOC -->
    <nav class="toc-inline">
      <a v-for="item in tocItems" :key="item.id" :href="`#${item.id}`" class="toc-link">{{ item.title }}</a>
    </nav>

    <!-- Overview -->
    <section id="overview" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.overview') }}</h2>
      <p class="prose">
        <strong>{{ t('chatbot.overview.introBold') }}</strong>{{ t('chatbot.overview.intro') }}
      </p>
      <p class="prose spec-note">
        <strong>{{ t('chatbot.overview.machineReadableSpecLabel') }}</strong>
        <a href="/chatbot-api.json" class="spec-link" target="_blank" rel="noopener noreferrer">{{ t('chatbot.overview.machineReadableSpecLink') }}</a>{{ t('chatbot.overview.machineReadableSpecDesc') }}
      </p>
      <h3 class="subsection-title">{{ t('chatbot.overview.gettingStartedTitle') }}</h3>
      <p class="prose">
        {{ t('chatbot.overview.gettingStartedBefore') }}<code>var pluginKey = 'PLUGIN_KEY'</code>{{ t('chatbot.overview.gettingStartedMiddle') }}<code>boot({ pluginKey })</code>{{ t('chatbot.overview.gettingStartedAfter') }}
      </p>
      <CodeBlock :code="overviewSnippet" lang="xml" label="HTML" />
      <p class="muted note">{{ t('messages.pluginKeyWhereToFind') }}</p>
      <div class="callout callout-info">
        <p class="prose">{{ t('chatbot.overview.configFromConsoleNote') }}</p>
        <p class="prose">{{ t('chatbot.overview.dataPluginKeyNote') }}</p>
      </div>
    </section>

    <!-- API Reference -->
    <section id="api-reference" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.apiReference') }}</h2>
      <ul class="list-disc">
        <li><strong>{{ t('chatbot.apiReference.callFormatLabel') }}</strong> {{ t('chatbot.apiReference.callFormat') }}</li>
      </ul>
      <div class="callout callout-info">
        <p class="prose">{{ t('chatbot.apiReference.queueNoteIntro') }}</p>
        <pre class="queue-stub"><code>{{ queueStubSnippet }}</code></pre>
        <p class="prose">{{ t('chatbot.apiReference.queueNoteOutro') }}</p>
      </div>
      <h3 class="subsection-title">{{ t('chatbot.apiReference.commandSummaryTitle') }}</h3>
      <div class="table-wrap">
        <table class="doc-table command-summary-table">
          <thead>
            <tr>
              <th class="col-command">command</th>
              <th class="col-purpose">{{ t('chatbot.apiReference.tableHeaderPurpose') }}</th>
              <th class="col-payload">{{ t('chatbot.apiReference.tableHeaderPayload') }}</th>
              <th class="col-remarks">{{ t('chatbot.apiReference.tableHeaderRemarks') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="col-command"><code>boot</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdBootPurpose') }}</td>
              <td class="col-payload"><pre class="payload-pre"><code>{{ bootPayloadSchema }}</code></pre></td>
              <td class="col-remarks pre-line">{{ t('chatbot.apiReference.cmdBootRemarks') }}</td>
            </tr>
            <tr>
              <td class="col-command"><code>update</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdUpdatePurpose') }}</td>
              <td class="col-payload"><pre class="payload-pre"><code>{{ updatePayloadSchema }}</code></pre></td>
              <td class="col-remarks pre-line">{{ t('chatbot.apiReference.cmdUpdateRemarks') }}</td>
            </tr>
            <tr>
              <td class="col-command"><code>open</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdOpenPurpose') }}</td>
              <td class="col-payload"><pre class="payload-pre"><code>{{ openPayloadSchema }}</code></pre></td>
              <td class="col-remarks pre-line">{{ t('chatbot.apiReference.cmdOpenRemarks') }}</td>
            </tr>
            <tr>
              <td class="col-command"><code>close</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdClosePurpose') }}</td>
              <td class="col-payload">—</td>
              <td class="col-remarks">—</td>
            </tr>
            <tr>
              <td class="col-command"><code>toggle</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdTogglePurpose') }}</td>
              <td class="col-payload">—</td>
              <td class="col-remarks">—</td>
            </tr>
            <tr>
              <td class="col-command"><code>destroy</code></td>
              <td class="col-purpose">{{ t('chatbot.apiReference.cmdDestroyPurpose') }}</td>
              <td class="col-payload">—</td>
              <td class="col-remarks">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 class="subsection-title">{{ t('chatbot.apiReference.bootPayloadTitle') }}</h3>
      <div class="table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>{{ t('chatbot.apiReference.payloadTableField') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableType') }}</th>
              <th class="col-required">{{ t('chatbot.apiReference.payloadTableRequired') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableDesc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>pluginKey</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadPluginKeyType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadPluginKeyRequired') }}</td>
              <td>{{ t('chatbot.apiReference.pluginKeyDescription') }}</td>
            </tr>
            <tr>
              <td><code>locale</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadLocaleType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadLocaleRequired') }}</td>
              <td class="pre-line">{{ t('chatbot.apiReference.bootPayloadLocaleBootDesc') }}</td>
            </tr>
            <tr>
              <td><code>gaTrackingId</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadGaTrackingIdType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadGaTrackingIdRequired') }}</td>
              <td class="pre-line">{{ t('chatbot.apiReference.gaTrackingIdDescription') }}</td>
            </tr>
            <tr>
              <td><code>userEmail</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadEmailType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadEmailRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadEmailDesc') }}</td>
            </tr>
            <tr>
              <td><code>userPhotoURL</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadUserPhotoUrlType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadUserPhotoUrlRequired') }}</td>
              <td>{{ t('chatbot.apiReference.bootPayloadUserPhotoUrlDesc') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="subsection-title">{{ t('chatbot.apiReference.updatePayloadTitle') }}</h3>
      <p class="muted">{{ t('chatbot.apiReference.updatePayloadNote') }}</p>
      <div class="table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>{{ t('chatbot.apiReference.payloadTableField') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableType') }}</th>
              <th class="col-required">{{ t('chatbot.apiReference.payloadTableRequired') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableDesc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>mode</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadModeType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadModeRequired') }}</td>
              <td>{{ t('chatbot.apiReference.modeDescription') }}</td>
            </tr>
            <tr>
              <td><code>locale</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadLocaleType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadLocaleRequired') }}</td>
              <td>{{ t('chatbot.apiReference.localeDescription') }}</td>
            </tr>
            <tr>
              <td><code>workspaceName</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadWorkspaceNameType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadWorkspaceNameRequired') }}</td>
              <td>{{ t('chatbot.apiReference.workspaceNameDescription') }}</td>
            </tr>
            <tr>
              <td><code>contentSelector</code></td>
              <td>{{ t('chatbot.apiReference.bootPayloadContentSelectorType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.bootPayloadContentSelectorRequired') }}</td>
              <td>{{ t('chatbot.apiReference.contentSelectorDescription') }}</td>
            </tr>
            <tr>
              <td><code>userEmail</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadEmailType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadEmailRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadEmailDesc') }}</td>
            </tr>
            <tr>
              <td><code>colorCode</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadColorCodeType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadColorCodeRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadColorCodeDesc') }}</td>
            </tr>
            <tr>
              <td><code>buttonText</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadButtonTextType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadButtonTextRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadButtonTextDesc') }}</td>
            </tr>
            <tr>
              <td><code>welcomeMessage</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadWelcomeMessageType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadWelcomeMessageRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadWelcomeMessageDesc') }}</td>
            </tr>
            <tr>
              <td><code>coverImage</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadCoverImageType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadCoverImageRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadCoverImageDesc') }}</td>
            </tr>
            <tr>
              <td><code>description</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadDescriptionType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadDescriptionRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadDescriptionDesc') }}</td>
            </tr>
            <tr>
              <td><code>imgUrl</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadImgUrlType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadImgUrlRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadImgUrlDesc') }}</td>
            </tr>
            <tr>
              <td><code>hideTrigger</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadHideTriggerType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadHideTriggerRequired') }}</td>
              <td>{{ t('chatbot.apiReference.updatePayloadHideTriggerDesc') }}</td>
            </tr>
            <tr>
              <td><code>dataset_ids</code></td>
              <td>{{ t('chatbot.apiReference.updatePayloadDatasetIdsType') }}</td>
              <td class="col-required">{{ t('chatbot.apiReference.updatePayloadDatasetIdsRequired') }}</td>
              <td class="payload-desc-cell">{{ t('chatbot.apiReference.updatePayloadDatasetIdsDesc') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 class="subsection-title">{{ t('chatbot.apiReference.openPayloadTitle') }}</h3>
      <div class="table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>{{ t('chatbot.apiReference.payloadTableField') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableType') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableRequired') }}</th>
              <th>{{ t('chatbot.apiReference.payloadTableDesc') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>dataset_ids</code></td>
              <td>{{ t('chatbot.apiReference.openPayloadDatasetIdsType') }}</td>
              <td>{{ t('chatbot.apiReference.openPayloadDatasetIdsRequired') }}</td>
              <td class="payload-desc-cell">{{ t('chatbot.apiReference.openPayloadDatasetIdsDesc') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="callout callout-info">
        <strong>{{ t('chatbot.apiReference.datasetIdInfoLabel') }}</strong> {{ t('chatbot.apiReference.datasetIdInfoCard') }}
      </div>
    </section>

    <!-- GA events -->
    <section id="ga-tracking" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.gaTracking') }}</h2>
      <p class="prose">{{ t('chatbot.gaTracking.intro') }}</p>
      <ul class="list-disc">
        <li>{{ t('chatbot.gaTracking.introBullet1') }}</li>
        <li>{{ t('chatbot.gaTracking.introBullet3') }}</li>
      </ul>
      <h3 class="subsection-title">{{ t('chatbot.gaTracking.eventsTableTitle') }}</h3>
      <div class="table-wrap">
        <table class="doc-table">
          <thead>
            <tr>
              <th>{{ t('chatbot.gaTracking.tableHeaderTrigger') }}</th>
              <th>{{ t('chatbot.gaTracking.tableHeaderEvent') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerOpen') }}</td>
              <td><code>fb_chat_opened</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerClose') }}</td>
              <td><code>fb_chat_closed</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerToggle') }}</td>
              <td><code>fb_chat_opened</code> / <code>fb_chat_closed</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerMessageSent') }}</td>
              <td><code>fb_message_sent</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerResponseDone') }}</td>
              <td><code>fb_response_done</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerDrawerOpened') }}</td>
              <td><code>fb_drawer_opened</code></td>
            </tr>
            <tr>
              <td>{{ t('chatbot.gaTracking.triggerNewConversation') }}</td>
              <td><code>fb_new_conversation</code></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="callout callout-info">
        <strong>{{ t('chatbot.gaTracking.licenseNoteLabel') }}</strong> {{ t('chatbot.gaTracking.licenseNote') }}
      </div>
    </section>

    <!-- Layout modes -->
    <section id="layout-modes" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.layoutModes') }}</h2>

      <div class="layout-card">
        <h3 class="layout-mode-name">floating</h3>
        <p class="prose">{{ t('chatbot.layoutModes.floating') }}</p>
        <img src="/layout-floating.png" alt="floating" class="layout-img" />
      </div>
      <div class="layout-card">
        <h3 class="layout-mode-name">overlay-fullscreen</h3>
        <p class="prose">{{ t('chatbot.layoutModes.overlayFullscreen') }}</p>
        <img src="/layout-overlay-fullscreen.png" alt="overlay-fullscreen" class="layout-img" />
      </div>
      <div class="layout-card">
        <h3 class="layout-mode-name">push-sidebar</h3>
        <p class="prose">{{ t('chatbot.layoutModes.pushSidebarIntro') }}</p>
        <ul class="list-disc">
          <li>{{ t('chatbot.layoutModes.pushSidebarBullet1') }}</li>
          <li>{{ t('chatbot.layoutModes.pushSidebarBullet2') }}</li>
        </ul>
        <p class="prose">{{ t('chatbot.layoutModes.pushSidebarSpa') }}</p>
        <p class="prose">{{ t('chatbot.layoutModes.pushSidebarUseCasePrefix') }}<strong>{{ t('chatbot.layoutModes.pushSidebarUseCaseBold') }}</strong>{{ t('chatbot.layoutModes.pushSidebarUseCaseSuffix') }}</p>
        <img src="/layout-push-sidebar.png" alt="push-sidebar" class="layout-img" />
      </div>
      <div class="callout callout-info">
        <strong>{{ t('chatbot.layoutModes.mobileNoteLabel') }}</strong> {{ t('chatbot.layoutModes.mobileNote') }}
      </div>
    </section>

    <!-- Code examples -->
    <section id="code-examples" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.codeExamples') }}</h2>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example1Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example1Desc') }}</p>
        <CodeBlock :code="example1Code" lang="xml" label="HTML" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example2Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example2Desc') }}</p>
        <CodeBlock :code="example2Code" lang="javascript" label="JavaScript" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example3Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example3Desc') }}</p>
        <CodeBlock :code="example3Code" lang="javascript" label="JavaScript" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example4Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example4Desc') }}</p>
        <CodeBlock :code="example4Code" lang="javascript" label="JavaScript" />
        <p class="prose muted">{{ t('chatbot.codeExamples.example4BootNote') }}</p>
        <CodeBlock :code="example4BootCode" lang="javascript" label="JavaScript" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example5Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example5Desc') }}</p>
        <CodeBlock :code="example5Code" lang="javascript" label="JavaScript" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example6Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example6Desc') }}</p>
        <CodeBlock :code="example6Code" lang="xml" label="HTML" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example7Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example7Desc') }}</p>
        <CodeBlock :code="openPayloadExampleWithIds" lang="javascript" label="JavaScript" />
        <CodeBlock :code="openPayloadExampleDefault" lang="javascript" label="JavaScript" />
      </div>

      <div class="example-block">
        <h3 class="subsection-title">{{ t('chatbot.codeExamples.example8Title') }}</h3>
        <p class="prose">{{ t('chatbot.codeExamples.example8Desc') }}</p>
        <CodeBlock :code="example8Code" lang="javascript" label="JavaScript" />
      </div>
    </section>

    <!-- Integration guide -->
    <section id="integration-guide" class="section scroll-mt">
      <h2 class="section-title">{{ t('chatbot.toc.integrationGuide') }}</h2>
      <div class="prose-block">
        <h3 class="subsection-title">{{ t('chatbot.integrationGuide.scriptPositionTitle') }}</h3>
        <p>{{ t('chatbot.integrationGuide.scriptPositionDesc') }}</p>
      </div>
      <div class="prose-block">
        <h3 class="subsection-title">{{ t('chatbot.integrationGuide.spaHandlingTitle') }}</h3>
        <p>{{ t('chatbot.integrationGuide.spaHandlingDesc') }}</p>
      </div>
      <div class="prose-block">
        <h3 class="subsection-title">{{ t('chatbot.integrationGuide.wrapperTitle') }}</h3>
        <p>{{ t('chatbot.integrationGuide.wrapperDesc') }}</p>
      </div>
      <div class="prose-block">
        <h3 class="subsection-title">{{ t('chatbot.integrationGuide.allowDomainTitle') }}</h3>
        <p>{{ t('chatbot.integrationGuide.allowDomainDesc') }}</p>
      </div>
      <div class="prose-block">
        <h3 class="subsection-title">{{ t('chatbot.integrationGuide.cspTitle') }}</h3>
        <p>{{ t('chatbot.integrationGuide.cspDesc') }}</p>
      </div>
      <div class="callout callout-info">
        <h3 class="subsection-title">{{ t('chatbot.apiReference.debugTitle') }}</h3>
        <p>{{ t('chatbot.apiReference.debugNote') }}</p>
      </div>
    </section>

    <!-- Summary -->
<!--    <section id="summary" class="section scroll-mt">-->
<!--      <h2 class="section-title">{{ t('chatbot.toc.summary') }}</h2>-->
<!--      <ul class="list-disc">-->
<!--        <li><strong>{{ t('chatbot.summary.pluginKeyIssue') }}</strong> {{ t('chatbot.summary.pluginKeyIssueDesc') }}</li>-->
<!--        <li><strong>{{ t('chatbot.summary.whenProblem') }}</strong> {{ t('chatbot.summary.whenProblemDesc') }}</li>-->
<!--      </ul>-->
<!--      <h3 class="subsection-title">{{ t('chatbot.summary.apiSummaryTableTitle') }}</h3>-->
<!--      <div class="table-wrap">-->
<!--        <table class="doc-table">-->
<!--          <thead>-->
<!--            <tr>-->
<!--              <th>command</th>-->
<!--              <th>{{ t('chatbot.summary.summaryTablePurpose') }}</th>-->
<!--            </tr>-->
<!--          </thead>-->
<!--          <tbody>-->
<!--            <tr><td><code>boot</code></td><td>{{ t('chatbot.summary.summaryBoot') }}</td></tr>-->
<!--            <tr><td><code>update</code></td><td>{{ t('chatbot.summary.summaryUpdate') }}</td></tr>-->
<!--            <tr><td><code>open</code></td><td>{{ t('chatbot.summary.summaryOpen') }}</td></tr>-->
<!--            <tr><td><code>close</code></td><td>{{ t('chatbot.summary.summaryClose') }}</td></tr>-->
<!--            <tr><td><code>toggle</code></td><td>{{ t('chatbot.summary.summaryToggle') }}</td></tr>-->
<!--            <tr><td><code>destroy</code></td><td>{{ t('chatbot.summary.summaryDestroy') }}</td></tr>-->
<!--          </tbody>-->
<!--        </table>-->
<!--      </div>-->
<!--    </section>-->
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'

const { t } = useI18n()

const queueStubSnippet = "window.FrontierBase = window.FrontierBase || function () { (window.FrontierBase.q = window.FrontierBase.q || []).push(arguments); };"

const bootPayloadSchema = `{
  "pluginKey": "PLUGIN_KEY",
  "locale": "ko",
  "gaTrackingId": "G-XXXXXXXXXX",
  "userEmail": "user@example.com",
  "userPhotoURL": "https://..."
}`

const updatePayloadSchema = `{
  "locale": "ko",
  "dataset_ids": ["dataset-a", "dataset-b"],
  "mode": "floating",
  "workspaceName": "Support",
  "colorCode": "#3e5bf0",
  "buttonText": "Chat",
  "welcomeMessage": "Hello",
  "coverImage": "https://...",
  "description": "...",
  "imgUrl": "https://...",
  "contentSelector": "#app",
  "userEmail": "user@example.com",
  "hideTrigger": false,
  "pluginKey": "PLUGIN_KEY"
}`

const openPayloadSchema = `{
  "dataset_ids": ["dataset-a", "dataset-b"]
}`

const tocItems = computed(() => [
  { id: 'overview', title: t('chatbot.toc.overview') },
  { id: 'api-reference', title: t('chatbot.toc.apiReference') },
  { id: 'ga-tracking', title: t('chatbot.toc.gaTracking') },
  { id: 'layout-modes', title: t('chatbot.toc.layoutModes') },
  { id: 'code-examples', title: t('chatbot.toc.codeExamples') },
  { id: 'integration-guide', title: t('chatbot.toc.integrationGuide') },
  { id: 'summary', title: t('chatbot.toc.summary') },
])

const scriptClose = '</' + 'script>'
const overviewSnippet = `<script>
  (function () {
    var pluginKey = 'PLUGIN_KEY';
    var w = window;
    var ns = 'FrontierBase';
    var s = document.createElement('script');
    s.id = ns;
    s.src = 'https://cdn.frontierbase.io/chatbot.js';
    s.defer = true;
    s.setAttribute('data-plugin-key', pluginKey);
    w[ns] = w[ns] || function () { (w[ns].q = w[ns].q || []).push(arguments); };
    w[ns]('boot', { pluginKey: pluginKey });
    document.head.appendChild(s);
  })();
${scriptClose}`

const example1Code = `<!DOCTYPE html>
<html>
<head><title>My Site</title></head>
<body>
  <h1>My Page</h1>
  <script>
    (function () {
      var pluginKey = 'PLUGIN_KEY';
      var w = window;
      var ns = 'FrontierBase';
      var s = document.createElement('script');
      s.id = ns;
      s.src = 'https://cdn.frontierbase.io/chatbot.js';
      s.defer = true;
      s.setAttribute('data-plugin-key', pluginKey);
      w[ns] = w[ns] || function () { (w[ns].q = w[ns].q || []).push(arguments); };
      w[ns]('boot', { pluginKey: pluginKey });
      document.head.appendChild(s);
    })();
  ` + scriptClose + `
</body>
</html>`

const example2Code = computed(() => `window.FrontierBase('boot', {
  pluginKey: 'PLUGIN_KEY',
  locale: 'ko',
  userEmail: 'user@example.com'
});

window.FrontierBase('update', {
  dataset_ids: ['purpose-a', 'purpose-b'],
  mode: 'overlay-fullscreen',
  workspaceName: '${t('chatbot.codeExamples.example2WorkspaceName')}'
});`)

const example3Code = `window.FrontierBase('boot', {
  pluginKey: 'PLUGIN_KEY'
});

window.FrontierBase('update', {
  mode: 'push-sidebar',
  contentSelector: '#app'
});`

const example4Code = `(function () {
  var pluginKey = 'PLUGIN_KEY';
  var w = window;
  var ns = 'FrontierBase';

  w[ns] = w[ns] || function () { (w[ns].q = w[ns].q || []).push(arguments); };

  var s = document.createElement('script');
  s.id = ns;
  s.src = 'https://cdn.frontierbase.io/chatbot.js';
  s.defer = true;
  s.setAttribute('data-plugin-key', pluginKey);
  document.head.appendChild(s);
})();`

const example4BootCode = `// Show the chat button when you are ready
window.FrontierBase('boot', {
  pluginKey: 'PLUGIN_KEY',
  locale: 'ko'
});

// RAG dataset scope (init + messages). Use update or open.
window.FrontierBase('update', {
  dataset_ids: ['purpose-a', 'purpose-b']
});`

const example5Code = computed(() => `window.FrontierBase('update', {
  mode: 'push-sidebar',
  workspaceName: '${t('chatbot.codeExamples.example5WorkspaceName')}',
  userEmail: 'user@example.com'
});`)

const example6Code = computed(() => `<button onclick="window.FrontierBase('open')">${t('chatbot.codeExamples.example6OpenBtn')}</button>
<button onclick="window.FrontierBase('close')">${t('chatbot.codeExamples.example6CloseBtn')}</button>
<button onclick="window.FrontierBase('toggle')">${t('chatbot.codeExamples.example6ToggleBtn')}</button>`)

const openPayloadExampleWithIds = computed(() => `// ${t('chatbot.apiReference.datasetIdsExampleWithIdsComment')}
window.FrontierBase('open', { dataset_ids: ['purpose-a', 'purpose-b'] });`)
const openPayloadExampleDefault = computed(() => `// ${t('chatbot.apiReference.datasetIdsExampleDefaultComment')}
window.FrontierBase('open');`)

const example8Code = `// GA events (PRO plan or above)
window.FrontierBase('boot', {
  pluginKey: 'PLUGIN_KEY',
  gaTrackingId: 'G-XXXXXXXXXX'
});`
</script>

<style scoped>
.chatbot-guide { max-width: 100%; }
.page-title { font-size: 1.75rem; font-weight: 700; margin: 0 0 1rem; color: var(--text); }
.scroll-mt { scroll-margin-top: 1rem; }
.pre-line { white-space: pre-line; }
.toc-inline { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; margin-bottom: 2rem; padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
.toc-link { color: var(--link); text-decoration: none; font-size: 0.9rem; }
.toc-link:hover { text-decoration: underline; }
.section { margin-bottom: 2.5rem; }
.section-title { font-size: 1.35rem; margin: 0 0 1rem; color: var(--text); }
.subsection-title { font-size: 1.1rem; margin: 1rem 0 0.5rem; color: var(--text); }
.prose, .prose-block p { color: var(--text-muted); line-height: var(--doc-line-height); margin: 0 0 0.75rem; font-size: 0.95rem; white-space: pre-line; }
.prose-block { margin-bottom: 1.25rem; }
.muted { font-size: 0.9rem; color: var(--text-muted); margin: 0 0 1rem; line-height: var(--doc-line-height); white-space: pre-line; }
.list-disc { margin: 0 0 1rem; padding-left: 1.25rem; }
.list-disc li { margin: 0.35rem 0; color: var(--text-muted); line-height: var(--doc-line-height); white-space: pre-line; }
.list-nested { margin-top: 0.25rem; margin-bottom: 0.5rem; }
.note { color: var(--link); font-size: 0.9rem; margin-bottom: 1rem; padding: 0.5rem 0.75rem; background: var(--code-bg); border-radius: 6px; border-left: 3px solid var(--link); line-height: var(--doc-line-height); }
.callout { padding: 1rem 1.25rem; border-radius: 8px; margin: 1rem 0; border-left: 4px solid; }
.callout p { line-height: var(--doc-line-height); margin: 0 0 0.75rem; color: var(--text-muted); }
.callout p:last-child { margin-bottom: 0; }
.callout-tip { background: var(--code-bg); border-left-color: #eab308; }
.callout-info { background: var(--code-bg); border-left-color: var(--link); }
.table-wrap { overflow-x: auto; margin: 1rem 0; border: 1px solid var(--border); border-radius: 8px; }
.doc-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.doc-table th, .doc-table td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; }
.doc-table th { background: var(--sidebar-bg); font-weight: 600; color: var(--text); }
.doc-table td { color: var(--text-muted); line-height: var(--doc-line-height); }
.doc-table td:nth-child(4) { white-space: pre-line; }
.doc-table code { font-size: 0.8em; }
.doc-table .col-required { min-width: 6.5em; white-space: nowrap; }
.command-summary-table .col-command { width: 5.5rem; white-space: nowrap; }
.command-summary-table .col-purpose { width: 14%; min-width: 9.5rem; }
.command-summary-table .col-payload { width: 30%; min-width: 12rem; vertical-align: top; }
.command-summary-table .col-remarks { width: 24%; max-width: 16rem; font-size: 0.85rem; vertical-align: top; line-height: var(--doc-line-height); }
.payload-pre { margin: 0; padding: 0; background: transparent; border: 0; font-size: 0.78rem; line-height: 1.55; white-space: pre; overflow-x: auto; }
.queue-stub { margin: 0.75rem 0; padding: 0.75rem 1rem; background: var(--bg); border-radius: 6px; font-size: 0.78rem; line-height: 1.55; white-space: pre-wrap; overflow-x: auto; }
.queue-stub code { font-size: inherit; background: transparent; padding: 0; }
.payload-pre code { font-size: inherit; background: transparent; padding: 0; }
.payload-desc-cell { max-width: 28rem; line-height: var(--doc-line-height); }
.layout-card { border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
.layout-mode-name { font-size: 1.05rem; margin: 0 0 0.5rem; color: var(--text); }
.layout-img { max-width: 100%; width: 100%; max-width: 32rem; border-radius: 8px; border: 1px solid var(--border); margin-top: 0.75rem; }
.example-block { margin-bottom: 2rem; }
.spec-link { color: var(--link); text-decoration: none; font-family: ui-monospace, monospace; font-size: 0.92em; }
.spec-link:hover { text-decoration: underline; }
.spec-note .spec-link { margin: 0 0.2em; }
</style>
