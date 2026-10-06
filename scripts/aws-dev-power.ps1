param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("sleep", "wake", "status")]
    [string]$Action
)

$ErrorActionPreference = "Stop"

# Fitness Assistant / Gymini DEV
$Region       = "ap-southeast-1"
$Cluster      = "fitness-assistant-dev-cluster"
$ChatService  = "fitness-assistant-dev-chat-service"
$Aurora       = "fitness-assistant-dev-aurora"

function Get-AuroraStatus {
    (aws rds describe-db-clusters `
        --db-cluster-identifier $Aurora `
        --region $Region `
        --query "DBClusters[0].Status" `
        --output text).Trim()
}

function Wait-AuroraStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TargetStatus
    )

    Write-Host "Waiting for Aurora => $TargetStatus ..."

    while ($true) {
        $status = Get-AuroraStatus
        Write-Host "Aurora: $status"

        if ($status -eq $TargetStatus) {
            break
        }

        if ($status -in @(
            "failed",
            "inaccessible-encryption-credentials",
            "inaccessible-encryption-credentials-recoverable"
        )) {
            throw "Aurora entered unexpected status: $status"
        }

        Start-Sleep -Seconds 15
    }
}

function Show-Status {
    Write-Host ""
    Write-Host "=== DEV STATUS ==="

    $dbStatus = Get-AuroraStatus
    Write-Host "Aurora: $dbStatus"

    Write-Host ""
    Write-Host "Chat ECS service:"
    aws ecs describe-services `
        --cluster $Cluster `
        --services $ChatService `
        --region $Region `
        --query "services[0].{service:serviceName,status:status,desired:desiredCount,running:runningCount,pending:pendingCount}" `
        --output table

    Write-Host ""
    Write-Host "Running ECS tasks:"
    aws ecs list-tasks `
        --cluster $Cluster `
        --desired-status RUNNING `
        --region $Region `
        --output table
}

switch ($Action) {

    "sleep" {
        Write-Host "=== DEV SLEEP ==="

        Write-Host ""
        Write-Host "1/2 Stop Chat ECS..."

        aws ecs update-service `
            --cluster $Cluster `
            --service $ChatService `
            --desired-count 0 `
            --region $Region `
            --query "service.{service:serviceName,desired:desiredCount,running:runningCount}" `
            --output table

        Write-Host "Waiting for ECS service to stabilize..."

        aws ecs wait services-stable `
            --cluster $Cluster `
            --services $ChatService `
            --region $Region

        Write-Host ""
        Write-Host "2/2 Stop Aurora..."

        $dbStatus = Get-AuroraStatus

        if ($dbStatus -eq "stopped") {
            Write-Host "Aurora is already stopped."
        }
        elseif ($dbStatus -eq "stopping") {
            Write-Host "Aurora is already stopping."
            Wait-AuroraStatus -TargetStatus "stopped"
        }
        else {
            aws rds stop-db-cluster `
                --db-cluster-identifier $Aurora `
                --region $Region `
                --query "DBCluster.{identifier:DBClusterIdentifier,status:Status}" `
                --output table

            Wait-AuroraStatus -TargetStatus "stopped"
        }

        Write-Host ""
        Write-Host "DEV sleep complete."

        Show-Status

        Write-Host ""
        Write-Host "NOTE:"
        Write-Host "NAT Gateway, VPC Endpoints, ALB, Public IPv4,"
        Write-Host "S3, ECR, Secrets Manager and storage are NOT deleted."
        Write-Host "Some AWS charges may continue while DEV is sleeping."
    }

    "wake" {
        Write-Host "=== DEV WAKE ==="

        Write-Host ""
        Write-Host "1/2 Start Aurora..."

        $dbStatus = Get-AuroraStatus

        if ($dbStatus -eq "available") {
            Write-Host "Aurora is already available."
        }
        elseif ($dbStatus -eq "starting") {
            Write-Host "Aurora is already starting."
            Wait-AuroraStatus -TargetStatus "available"
        }
        else {
            aws rds start-db-cluster `
                --db-cluster-identifier $Aurora `
                --region $Region `
                --query "DBCluster.{identifier:DBClusterIdentifier,status:Status}" `
                --output table

            Wait-AuroraStatus -TargetStatus "available"
        }

        Write-Host ""
        Write-Host "2/2 Start Chat ECS..."

        aws ecs update-service `
            --cluster $Cluster `
            --service $ChatService `
            --desired-count 1 `
            --force-new-deployment `
            --region $Region `
            --query "service.{service:serviceName,desired:desiredCount,running:runningCount}" `
            --output table

        Write-Host "Waiting for ECS service to stabilize..."

        aws ecs wait services-stable `
            --cluster $Cluster `
            --services $ChatService `
            --region $Region

        Write-Host ""
        Write-Host "DEV wake complete."

        Show-Status
    }

    "status" {
        Show-Status
    }
}
