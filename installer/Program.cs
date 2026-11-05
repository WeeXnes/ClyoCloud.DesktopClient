using System;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;
using InstallerFramework.Core.Actions;
using InstallerFramework.Core.Builder;
using InstallerFramework.Core.Services;
using InstallerFramework.UI;

namespace ClyoCloudInstaller
{
    internal class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            bool isWindows = OperatingSystem.IsWindows();

            string defaultInstallPath = isWindows
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "ClyoCloud")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share", "clyocloud");

            string targetExecutable = isWindows
                ? @"{TargetDir}\clyocloud.exe"
                : @"{TargetDir}/clyocloud";

            string appVersion = GetAppVersion();

            string payloadZipPath = Path.Combine(AppContext.BaseDirectory, "payload.zip");
            string payloadDir = Path.Combine(AppContext.BaseDirectory, "Payload");

            string licenseText = @"ClyoCloud Desktop Client License Agreement

Copyright (c) ClyoCloud. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the ""Software""), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.";

            var builder = InstallerBuilder.Create("ClyoCloud")
                .WithVersion(appVersion)
                .WithPublisher("ClyoCloud")
                .WithDefaultDirectory(defaultInstallPath)
                .RequireAdmin(ElevationMode.AutoDetect)
                
                // 1. Welcome Page
                .AddWelcomePage(
                    title: "Welcome to ClyoCloud Setup",
                    welcomeText: "This wizard will install ClyoCloud Desktop Client on your computer.\n\nClyoCloud provides real-time folder synchronization, instant clipboard uploads, and cloud wallpaper management living directly in your system tray.\n\nClick Next to continue.")
                
                // 2. License Agreement Page
                .AddLicensePage(licenseText)
                
                // 3. Destination Folder Selection
                .AddDirectoryPage()
                
                // 4. Custom Configuration Options
                .AddConfigPage(c => c
                    .WithTitle("Installation Options", "Configure shortcuts and system integration.")
                    .AddCheckbox("create_desktop_shortcut", "Create Desktop Shortcut", defaultValue: true)
                    .AddCheckbox("create_startmenu_shortcut", isWindows ? "Create Start Menu Shortcut" : "Create Application Menu Shortcut", defaultValue: true));

            // 5. Actions Pipeline: Deploy binaries from embedded/external payload
            if (File.Exists(payloadZipPath) || HasEmbeddedResource("payload.zip"))
            {
                builder.AddStep("Deploying ClyoCloud Binaries", new ExtractZipAction("payload.zip", "{TargetDir}"));
            }
            else if (Directory.Exists(payloadDir))
            {
                builder.AddStep("Deploying ClyoCloud Binaries", new CopyDirectoryAction(payloadDir, "{TargetDir}"));
            }
            else
            {
                builder.AddStep("Deploying ClyoCloud Binaries", new ExtractZipAction("payload.zip", "{TargetDir}"));
            }

            // Shortcuts Actions
            if (isWindows)
            {
                builder.AddStep("Creating Start Menu Shortcut", new CreateShortcutAction(
                    shortcutPath: @"{StartMenu}\ClyoCloud\ClyoCloud.lnk",
                    targetExecutable: targetExecutable,
                    workingDir: @"{TargetDir}",
                    description: "ClyoCloud Desktop Client",
                    conditionVariableKey: "create_startmenu_shortcut",
                    actionName: "Creating Start Menu Shortcut",
                    iconPath: @"{TargetDir}\app.ico",
                    displayName: "ClyoCloud"));

                builder.AddStep("Creating Desktop Shortcut", new CreateShortcutAction(
                    shortcutPath: @"{Desktop}\ClyoCloud.lnk",
                    targetExecutable: targetExecutable,
                    workingDir: @"{TargetDir}",
                    description: "ClyoCloud Desktop Client",
                    conditionVariableKey: "create_desktop_shortcut",
                    actionName: "Creating Desktop Shortcut",
                    iconPath: @"{TargetDir}\app.ico",
                    displayName: "ClyoCloud"));
            }
            else
            {
                builder.AddStep("Creating Application Menu Shortcut", new CreateShortcutAction(
                    shortcutPath: @"{UserProfile}/.local/share/applications/clyocloud.desktop",
                    targetExecutable: targetExecutable,
                    workingDir: @"{TargetDir}",
                    description: "ClyoCloud Desktop Client",
                    conditionVariableKey: "create_startmenu_shortcut",
                    actionName: "Creating Application Shortcut",
                    iconPath: @"{TargetDir}/clyocloud.png",
                    displayName: "ClyoCloud",
                    categories: "Network;FileTransfer;Utility;",
                    startupWMClass: "clyocloud"));

                builder.AddStep("Creating Desktop Shortcut", new CreateShortcutAction(
                    shortcutPath: @"{Desktop}/clyocloud.desktop",
                    targetExecutable: targetExecutable,
                    workingDir: @"{TargetDir}",
                    description: "ClyoCloud Desktop Client",
                    conditionVariableKey: "create_desktop_shortcut",
                    actionName: "Creating Desktop Shortcut",
                    iconPath: @"{TargetDir}/clyocloud.png",
                    displayName: "ClyoCloud",
                    categories: "Network;FileTransfer;Utility;",
                    startupWMClass: "clyocloud"));
            }

            // 6. Completion Page
            var config = builder
                .AddCompletionPage(launchExecutableOnFinish: targetExecutable)
                .Build();

            // Run Avalonia Installer GUI
            InstallerRunner.Run(config, args);
        }

        private static bool HasEmbeddedResource(string resourceName)
        {
            var assembly = System.Reflection.Assembly.GetEntryAssembly();
            if (assembly == null) return false;
            var formattedName = resourceName.Replace('\\', '.').Replace('/', '.');
            return Array.Exists(assembly.GetManifestResourceNames(), n => n.EndsWith(formattedName, StringComparison.OrdinalIgnoreCase));
        }

        private static string GetAppVersion()
        {
            try
            {
                var assembly = System.Reflection.Assembly.GetEntryAssembly();
                if (assembly != null)
                {
                    var resName = Array.Find(assembly.GetManifestResourceNames(), n => n.EndsWith("version.txt", StringComparison.OrdinalIgnoreCase));
                    if (resName != null)
                    {
                        using var stream = assembly.GetManifestResourceStream(resName);
                        if (stream != null)
                        {
                            using var reader = new StreamReader(stream);
                            var ver = reader.ReadToEnd().Trim();
                            if (!string.IsNullOrEmpty(ver)) return ver;
                        }
                    }

                    var infoVer = assembly.GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>()?.InformationalVersion;
                    if (!string.IsNullOrWhiteSpace(infoVer) && infoVer != "1.0.0" && !infoVer.StartsWith("1.0.0+"))
                    {
                        var plusIdx = infoVer.IndexOf('+');
                        return plusIdx > 0 ? infoVer.Substring(0, plusIdx) : infoVer;
                    }

                    var asmVer = assembly.GetName().Version;
                    if (asmVer != null && asmVer.ToString() != "1.0.0.0" && asmVer.ToString() != "0.0.0.0")
                    {
                        return $"{asmVer.Major}.{asmVer.Minor}.{asmVer.Build}";
                    }
                }
            }
            catch { }

            try
            {
                var pkgPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "package.json");
                if (File.Exists(pkgPath))
                {
                    var text = File.ReadAllText(pkgPath);
                    var match = Regex.Match(text, "\"version\":\\s*\"([^\"]+)\"");
                    if (match.Success) return match.Groups[1].Value;
                }
            }
            catch { }

            return "1.0.6";
        }
    }
}
