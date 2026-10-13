{{- define "osva.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "osva.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osva.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" -}}
{{- end -}}

{{- define "osva.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "osva.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "osva.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "osva.mcpAllowedHosts" -}}
{{- if .Values.mcp.allowedHosts -}}
{{- join "," .Values.mcp.allowedHosts -}}
{{- else if .Values.ingress.mcp.enabled -}}
{{- .Values.ingress.mcp.host -}}
{{- else -}}
{{- end -}}
{{- end -}}

{{- define "osva.mcpApiBaseUrl" -}}
{{- if .Values.mcp.apiBaseUrl -}}
{{- .Values.mcp.apiBaseUrl -}}
{{- else -}}
{{- $port := .Values.web.service.port -}}
{{- if eq (int $port) 80 -}}
{{- printf "http://%s-web" (include "osva.fullname" .) -}}
{{- else -}}
{{- printf "http://%s-web:%v" (include "osva.fullname" .) $port -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osva.artifactVolumeMount" }}
{{- if eq .Values.artifactStorage.driver "filesystem" }}
- name: artifacts
  mountPath: {{ .Values.artifactStorage.filesystemRoot | quote }}
{{- end }}
{{- end }}

{{- define "osva.artifactVolume" }}
{{- if eq .Values.artifactStorage.driver "filesystem" }}
- name: artifacts
  emptyDir: {}
{{- end }}
{{- end }}

{{- define "osva.usesSecretEnv" -}}
{{- if and .Values.secretEnv (gt (len .Values.secretEnv) 0) -}}
true
{{- end -}}
{{- end -}}

{{- define "osva.envSecretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else if include "osva.usesSecretEnv" . -}}
{{- printf "%s-secrets" (include "osva.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "osva.omitSensitiveConfig" -}}
{{- if .Values.existingSecret -}}
true
{{- end -}}
{{- end -}}

{{- define "osva.workloadEnvFrom" -}}
- configMapRef:
    name: {{ include "osva.fullname" . }}-env
{{- if include "osva.envSecretName" . }}
- secretRef:
    name: {{ include "osva.envSecretName" . }}
{{- end }}
{{- with .Values.extraEnvFrom }}
{{- toYaml . | nindent 0 }}
{{- end }}
{{- end -}}

{{- define "osva.otelServiceName" -}}
{{- if and .root.Values.telemetry .root.Values.telemetry.serviceNameOverride -}}
{{- .root.Values.telemetry.serviceNameOverride -}}
{{- else -}}
{{- .default -}}
{{- end -}}
{{- end -}}

{{- define "osva.validateTelemetry" -}}
{{- if and .Values.telemetry .Values.telemetry.enabled -}}
{{- if not .Values.telemetry.otlpEndpoint -}}
{{- fail "telemetry.otlpEndpoint is required when telemetry.enabled is true" -}}
{{- end -}}
{{- $sampler := .Values.telemetry.tracesSampler | default "parentbased_always_on" -}}
{{- $allowed := dict "always_on" true "always_off" true "traceidratio" true "parentbased_always_on" true "parentbased_always_off" true "parentbased_traceidratio" true -}}
{{- if not (index $allowed $sampler) -}}
{{- fail "telemetry.tracesSampler must be one of always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off, parentbased_traceidratio" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "osva.containerEnvBlock" -}}
{{- $root := .root -}}
{{- $hasExtra := and $root.Values.extraEnv (gt (len $root.Values.extraEnv) 0) -}}
{{- if or (and $root.Values.telemetry $root.Values.telemetry.enabled) $hasExtra }}
env:
{{- if and $root.Values.telemetry $root.Values.telemetry.enabled }}
  - name: OTEL_SERVICE_NAME
    value: {{ include "osva.otelServiceName" (dict "root" $root "default" .serviceName) | quote }}
{{- end }}
{{- with $root.Values.extraEnv }}
{{ toYaml . | nindent 2 }}
{{- end }}
{{- end }}
{{- end -}}

{{- define "osva.processProbes" -}}
ports:
  - name: health
    containerPort: {{ (.Values.health).port | default 8081 }}
startupProbe:
  httpGet:
    path: /ready
    port: health
  failureThreshold: 12
  periodSeconds: 5
livenessProbe:
  httpGet:
    path: /health
    port: health
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /ready
    port: health
  periodSeconds: 5
{{- end -}}
