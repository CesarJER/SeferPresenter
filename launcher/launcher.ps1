Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# 1. Obtener la IP de red local
function Get-LocalIP {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.IPAddress -notlike "127.*" -and 
        $_.IPAddress -notlike "169.254.*" -and 
        $_.InterfaceAlias -match "Wi-Fi|Ethernet|WiFi|Red"
    } | Select-Object -First 1).IPAddress

    if (-not $ip) {
        $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
            $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" 
        } | Select-Object -First 1).IPAddress
    }
    
    if (-not $ip) { $ip = "127.0.0.1" }
    return $ip
}

$localIP = Get-LocalIP
$port = "5173" # Puerto por defecto de Vite
$networkUrl = "http://$localIP`:$port"
$localUrl = "http://localhost`:$port"

# 2. XAML de la Interfaz Visual (Estetica Premium Dark Mode - ASCII safe)
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="SeferPresenter Launcher" Height="550" Width="700" 
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        WindowStartupLocation="CenterScreen" ResizeMode="NoResize">
    
    <Border CornerRadius="16" Background="#11121d" BorderBrush="#2a2c3f" BorderThickness="1.5">
        <Border.Effect>
            <DropShadowEffect BlurRadius="25" ShadowDepth="0" Color="#000000" Opacity="0.6"/>
        </Border.Effect>
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="50"/> <!-- Cabecera / Barra de arrastre -->
                <RowDefinition Height="Auto"/> <!-- Estado y Datos de IP -->
                <RowDefinition Height="*"/> <!-- Log de Consola -->
                <RowDefinition Height="80"/> <!-- Botonera de Control -->
            </Grid.RowDefinitions>

            <!-- Cabecera -->
            <Grid Grid.Row="0" Name="HeaderBar" Background="#161726" Cursor="Hand">
                <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                </Grid.ColumnDefinitions>
                <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="15,0,0,0">
                    <TextBlock Text="[x]" Foreground="#a6e3a1" FontSize="14" FontWeight="Bold" VerticalAlignment="Center" Margin="0,0,8,0"/>
                    <TextBlock Text="SeferPresenter" Foreground="#ffffff" FontSize="16" FontWeight="SemiBold" VerticalAlignment="Center"/>
                    <TextBlock Text=" Launcher" Foreground="#8a8dbe" FontSize="16" FontWeight="Light" VerticalAlignment="Center"/>
                </StackPanel>
                <StackPanel Grid.Column="1" Orientation="Horizontal" Margin="0,0,10,0" VerticalAlignment="Center">
                    <Button Name="BtnMinimize" Content="-" Width="32" Height="32" Background="Transparent" Foreground="#a6adc8" BorderThickness="0" FontSize="12" Margin="0,0,5,0" Cursor="Hand">
                        <Button.Resources>
                            <Style TargetType="Border">
                                <Setter Property="CornerRadius" Value="16"/>
                            </Style>
                        </Button.Resources>
                    </Button>
                    <Button Name="BtnClose" Content="X" Width="32" Height="32" Background="Transparent" Foreground="#f38ba8" BorderThickness="0" FontSize="12" Cursor="Hand">
                        <Button.Resources>
                            <Style TargetType="Border">
                                <Setter Property="CornerRadius" Value="16"/>
                            </Style>
                        </Button.Resources>
                    </Button>
                </StackPanel>
            </Grid>

            <!-- Panel de Estado y Enlaces -->
            <StackPanel Grid.Row="1" Margin="25,20,25,10">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    <StackPanel>
                        <TextBlock Text="ESTADO DEL SERVIDOR" Foreground="#6c7086" FontSize="10" FontWeight="Bold"/>
                        <StackPanel Orientation="Horizontal" Margin="0,5,0,0">
                            <Ellipse Name="StatusDot" Width="10" Height="10" Fill="#f38ba8" VerticalAlignment="Center" Margin="0,0,8,0"/>
                            <TextBlock Name="StatusText" Text="Servidor Apagado" Foreground="#f38ba8" FontSize="15" FontWeight="SemiBold"/>
                        </StackPanel>
                    </StackPanel>
                    
                    <StackPanel Grid.Column="1" HorizontalAlignment="Right">
                        <TextBlock Text="DIRECCION DE RED (IP)" Foreground="#6c7086" FontSize="10" FontWeight="Bold" HorizontalAlignment="Right"/>
                        <TextBlock Name="TxtIPAddress" Text="$networkUrl" Foreground="#89b4fa" FontSize="15" FontWeight="SemiBold" Margin="0,5,0,0" HorizontalAlignment="Right"/>
                    </StackPanel>
                </Grid>
                <Border Height="1" Background="#2a2c3f" Margin="0,15,0,5"/>
            </StackPanel>

            <!-- Consola de Salida -->
            <Grid Grid.Row="2" Margin="25,5,25,10">
                <Grid.RowDefinitions>
                    <RowDefinition Height="Auto"/>
                    <RowDefinition Height="*"/>
                </Grid.RowDefinitions>
                <TextBlock Text="LOG DE SALIDA (VITE)" Foreground="#6c7086" FontSize="10" FontWeight="Bold" Margin="0,0,0,5"/>
                <TextBox Grid.Row="1" Name="ConsoleLog" IsReadOnly="True" 
                         VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
                         Background="#181825" Foreground="#cdd6f4" BorderBrush="#2a2c3f" BorderThickness="1"
                         FontFamily="Consolas" FontSize="12" Padding="10" AcceptsReturn="True"/>
            </Grid>

            <!-- Botones de Accion -->
            <Border Grid.Row="3" Background="#161726" CornerRadius="0,0,16,16">
                <Grid>
                    <Grid.ColumnDefinitions>
                        <ColumnDefinition Width="*"/>
                        <ColumnDefinition Width="Auto"/>
                    </Grid.ColumnDefinitions>
                    
                    <!-- Controles del servidor -->
                    <StackPanel Orientation="Horizontal" Margin="25,0,0,0" VerticalAlignment="Center">
                        <Button Name="BtnStart" Content="Iniciar Servidor" Width="140" Height="38" Background="#a6e3a1" Foreground="#11121d" FontWeight="Bold" BorderThickness="0" Cursor="Hand" Margin="0,0,10,0">
                            <Button.Resources>
                                <Style TargetType="Border">
                                    <Setter Property="CornerRadius" Value="8"/>
                                </Style>
                            </Button.Resources>
                        </Button>
                        <Button Name="BtnStop" Content="Detener" Width="100" Height="38" Background="#f38ba8" Foreground="#11121d" FontWeight="Bold" BorderThickness="0" Cursor="Hand" IsEnabled="False">
                            <Button.Resources>
                                <Style TargetType="Border">
                                    <Setter Property="CornerRadius" Value="8"/>
                                </Style>
                            </Button.Resources>
                        </Button>
                    </StackPanel>

                    <!-- Controles de Navegador -->
                    <StackPanel Grid.Column="1" Orientation="Horizontal" Margin="0,0,25,0" VerticalAlignment="Center">
                        <Button Name="BtnOpenLocal" Content="Abrir Localhost" Width="120" Height="38" Background="#313244" Foreground="#cdd6f4" FontWeight="Medium" BorderThickness="0" Cursor="Hand" Margin="0,0,10,0" IsEnabled="False">
                            <Button.Resources>
                                <Style TargetType="Border">
                                    <Setter Property="CornerRadius" Value="8"/>
                                </Style>
                            </Button.Resources>
                        </Button>
                        <Button Name="BtnOpenNetwork" Content="Abrir en Chrome (Red IP)" Width="170" Height="38" Background="#89b4fa" Foreground="#11121d" FontWeight="Bold" BorderThickness="0" Cursor="Hand" IsEnabled="False">
                            <Button.Resources>
                                <Style TargetType="Border">
                                    <Setter Property="CornerRadius" Value="8"/>
                                </Style>
                            </Button.Resources>
                        </Button>
                    </StackPanel>
                </Grid>
            </Border>
        </Grid>
    </Border>
</Window>
"@

# 3. Inicializar ventana y elementos
$reader = New-Object System.Xml.XmlNodeReader $xaml
$window = [Windows.Markup.XamlReader]::Load($reader)

# Encontrar controles
$headerBar = $window.FindName("HeaderBar")
$btnClose = $window.FindName("BtnClose")
$btnMinimize = $window.FindName("BtnMinimize")
$btnStart = $window.FindName("BtnStart")
$btnStop = $window.FindName("BtnStop")
$btnOpenLocal = $window.FindName("BtnOpenLocal")
$btnOpenNetwork = $window.FindName("BtnOpenNetwork")
$statusDot = $window.FindName("StatusDot")
$statusText = $window.FindName("StatusText")
$consoleLog = $window.FindName("ConsoleLog")

# 4. Variables de Estado
$script:viteProcess = $null
$script:dispatcherTimer = $null

# Log de consola inicial
$consoleLog.AppendText("[Launcher] Listo. Haz clic en 'Iniciar Servidor' para comenzar.`r`n")

# 5. Funciones auxiliares
function Update-UI-Status {
    param([bool]$running)
    if ($running) {
        $statusDot.Fill = [System.Windows.Media.Brushes]::LimeGreen
        $statusText.Text = "Servidor Activo (Red)"
        $statusText.Foreground = [System.Windows.Media.Brushes]::LimeGreen
        $btnStart.IsEnabled = $false
        $btnStop.IsEnabled = $true
        $btnOpenLocal.IsEnabled = $true
        $btnOpenNetwork.IsEnabled = $true
    } else {
        $statusDot.Fill = [System.Windows.Media.Brushes]::LightPink
        $statusText.Text = "Servidor Apagado"
        $statusText.Foreground = [System.Windows.Media.Brushes]::LightPink
        $btnStart.IsEnabled = $true
        $btnStop.IsEnabled = $false
        $btnOpenLocal.IsEnabled = $false
        $btnOpenNetwork.IsEnabled = $false
    }
}

# 6. Eventos de la ventana
$headerBar.add_MouseLeftButtonDown({
    $window.DragMove()
})

$btnClose.add_Click({
    Stop-Server
    $window.Close()
})

$btnMinimize.add_Click({
    $window.WindowState = [System.Windows.WindowState]::Minimized
})

# Iniciar servidor
$btnStart.add_Click({
    $consoleLog.AppendText("[Launcher] Iniciando servidor de desarrollo con --host...`r`n")
    
    # Detener si hay uno anterior
    Stop-Server

    $script:logPath = Join-Path $PSScriptRoot "vite_dev.log"
    $script:lastLogPosition = 0
    if (Test-Path $script:logPath) {
        Remove-Item $script:logPath -Force -ErrorAction SilentlyContinue
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $projDir = Split-Path -Path $PSScriptRoot -Parent
    $psi.WorkingDirectory = $projDir
    # Redirigimos la salida estandar y errores a un archivo de log para evitar bloquear la UI
    $psi.Arguments = "/c npm run dev -- --host > `"$script:logPath`" 2>&1"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $script:viteProcess = New-Object System.Diagnostics.Process
    $script:viteProcess.StartInfo = $psi
    
    if ($script:viteProcess.Start()) {
        Update-UI-Status -running $true
        
        $script:timerTicks = 0
        $script:dispatcherTimer = New-Object System.Windows.Threading.DispatcherTimer
        $script:dispatcherTimer.Interval = [TimeSpan]::FromMilliseconds(100)
        
        $script:dispatcherTimer.add_Tick({
            # Leer el archivo de log de forma no bloqueante
            if (Test-Path $script:logPath) {
                try {
                    $stream = [System.IO.File]::Open($script:logPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                    $reader = New-Object System.IO.StreamReader($stream)
                    if ($script:lastLogPosition -lt $stream.Length) {
                        [void]$stream.Seek($script:lastLogPosition, [System.IO.SeekOrigin]::Begin)
                        $newText = $reader.ReadToEnd()
                        if ($newText) {
                            $consoleLog.AppendText($newText)
                            $consoleLog.ScrollToEnd()
                        }
                        $script:lastLogPosition = $stream.Position
                    }
                    $reader.Close()
                    $stream.Close()
                } catch {
                    # Ignorar errores temporales de bloqueo de archivo
                }
            }


            # Comprobar si el proceso ha terminado de forma externa
            if ($script:viteProcess -and $script:viteProcess.HasExited) {
                $consoleLog.AppendText("[Launcher] El servidor se ha detenido.`r`n")
                $script:dispatcherTimer.Stop()
                Update-UI-Status -running $false
            }
        })
        $script:dispatcherTimer.Start()
    } else {
        $consoleLog.AppendText("[Error] No se pudo iniciar el proceso cmd.exe`r`n")
    }
})

# Detener servidor
function Stop-Server {
    if ($script:dispatcherTimer) {
        $script:dispatcherTimer.Stop()
        $script:dispatcherTimer = $null
    }
    if ($script:viteProcess) {
        if (-not $script:viteProcess.HasExited) {
            $consoleLog.AppendText("[Launcher] Deteniendo procesos asociados a Vite...`r`n")
            # Detener el arbol de procesos de forma limpia usando taskkill
            Stop-Process -Id $script:viteProcess.Id -Force -ErrorAction SilentlyContinue
            Start-Process -FilePath "taskkill" -ArgumentList "/F /T /IM node.exe" -WindowStyle Hidden -ErrorAction SilentlyContinue
            Start-Process -FilePath "taskkill" -ArgumentList "/F /T /IM vite.exe" -WindowStyle Hidden -ErrorAction SilentlyContinue
        }
        $script:viteProcess = $null
    }
    
    # Limpiar archivo de log al detener
    if (Test-Path $script:logPath) {
        Remove-Item $script:logPath -Force -ErrorAction SilentlyContinue
    }
    Update-UI-Status -running $false
}

$btnStop.add_Click({
    Stop-Server
})

# Abrir navegadores
function Open-Browser {
    param([string]$url)
    $consoleLog.AppendText("[Launcher] Abriendo Chrome en: $url`r`n")
    
    # Intentar buscar Chrome por su ruta por defecto en Windows
    $chromePaths = @(
        "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
    )
    
    $chromePath = $null
    foreach ($path in $chromePaths) {
        if (Test-Path $path) {
            $chromePath = $path
            break
        }
    }
    
    if ($chromePath) {
        # Abrir directamente con Chrome
        Start-Process -FilePath $chromePath -ArgumentList $url
    } else {
        # Abrir con navegador por defecto
        Start-Process $url
    }
}

$btnOpenLocal.add_Click({
    Open-Browser -url $localUrl
})

$btnOpenNetwork.add_Click({
    Open-Browser -url $networkUrl
})

# Iniciar bucle de eventos WPF
[void]$window.ShowDialog()
