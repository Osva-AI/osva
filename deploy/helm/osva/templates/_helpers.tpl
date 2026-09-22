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
