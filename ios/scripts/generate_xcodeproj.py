#!/usr/bin/env python3
"""Generate a minimal but valid Xcode project for Savor on Linux CI."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "Savor.xcodeproj"
SOURCES_ROOT = ROOT / "Savor"
PACKAGE_REF = "SplatCore"


def nid() -> str:
    return uuid.uuid4().hex[:24].upper()


IDS = {
    "project": nid(),
    "target": nid(),
    "sources_phase": nid(),
    "resources_phase": nid(),
    "frameworks_phase": nid(),
    "target_dep": nid(),
    "product_ref": nid(),
    "products_group": nid(),
    "main_group": nid(),
    "savor_group": nid(),
    "sources_build": nid(),
    "resources_build": nid(),
    "project_config_list": nid(),
    "target_config_list": nid(),
    "project_debug": nid(),
    "project_release": nid(),
    "target_debug": nid(),
    "target_release": nid(),
    "package_ref": nid(),
    "package_product": nid(),
    "assets": nid(),
    "assets_build": nid(),
    "samples": nid(),
    "samples_build": nid(),
    "info": nid(),
}


def collect_swift_files() -> list[Path]:
    files = sorted(SOURCES_ROOT.rglob("*.swift"))
    return [p for p in files if p.is_file()]


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def main() -> None:
    swift_files = collect_swift_files()
    file_ids: dict[Path, str] = {p: nid() for p in swift_files}
    build_ids: dict[Path, str] = {p: nid() for p in swift_files}

    # Group hierarchy by folder
    groups: dict[str, str] = {}
    group_children: dict[str, list[str]] = {}

    def ensure_group(parts: tuple[str, ...]) -> str:
        key = "/".join(parts)
        if key in groups:
            return groups[key]
        gid = nid()
        groups[key] = gid
        group_children[key] = []
        if len(parts) > 1:
            parent = ensure_group(parts[:-1])
            parent_key = "/".join(parts[:-1])
            group_children[parent_key].append(gid)
        else:
            group_children.setdefault("Savor", [])
            if key != "Savor":
                # attach under Savor root group later
                pass
        return gid

    savor_group = IDS["savor_group"]
    groups["Savor"] = savor_group
    group_children["Savor"] = []

    for path in swift_files:
        rel_parts = path.relative_to(SOURCES_ROOT).parts
        folder_parts = ("Savor",) + rel_parts[:-1]
        if len(folder_parts) == 1:
            group_children["Savor"].append(file_ids[path])
        else:
            # ensure nested groups
            for i in range(2, len(folder_parts) + 1):
                ensure_group(folder_parts[:i])
            parent_key = "/".join(folder_parts)
            # link nested group into parent
            if len(folder_parts) == 2:
                child_gid = groups[parent_key]
                if child_gid not in group_children["Savor"]:
                    group_children["Savor"].append(child_gid)
            else:
                parent_parent = "/".join(folder_parts[:-1])
                child_gid = groups[parent_key]
                if child_gid not in group_children[parent_parent]:
                    group_children[parent_parent].append(child_gid)
            group_children[parent_key].append(file_ids[path])

    # Assets + samples as resources
    assets_path = SOURCES_ROOT / "Resources" / "Assets.xcassets"
    samples_path = SOURCES_ROOT / "Resources" / "Samples"
    info_path = SOURCES_ROOT / "Info.plist"

    objects: list[str] = []

    # File refs for swift
    for path, fid in file_ids.items():
        objects.append(
            f'\t\t{fid} /* {path.name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {path.name}; sourceTree = "<group>"; }};'
        )

    objects.append(
        f'\t\t{IDS["product_ref"]} /* Savor.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Savor.app; sourceTree = BUILT_PRODUCTS_DIR; }};'
    )
    objects.append(
        f'\t\t{IDS["assets"]} /* Assets.xcassets */ = {{isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>"; }};'
    )
    objects.append(
        f'\t\t{IDS["samples"]} /* Samples */ = {{isa = PBXFileReference; lastKnownFileType = folder; path = Samples; sourceTree = "<group>"; }};'
    )
    objects.append(
        f'\t\t{IDS["info"]} /* Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; }};'
    )

    # Build files
    for path, bid in build_ids.items():
        objects.append(
            f'\t\t{bid} /* {path.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_ids[path]} /* {path.name} */; }};'
        )
    objects.append(
        f'\t\t{IDS["assets_build"]} /* Assets.xcassets in Resources */ = {{isa = PBXBuildFile; fileRef = {IDS["assets"]} /* Assets.xcassets */; }};'
    )
    objects.append(
        f'\t\t{IDS["samples_build"]} /* Samples in Resources */ = {{isa = PBXBuildFile; fileRef = {IDS["samples"]} /* Samples */; }};'
    )
    objects.append(
        f'\t\t{IDS["package_product"]} /* SplatCore in Frameworks */ = {{isa = PBXBuildFile; productRef = {IDS["target_dep"]} /* SplatCore */; }};'
    )

    # Groups
    def emit_group(key: str, name: str | None, path: str | None, children: list[str]) -> None:
        gid = groups[key] if key in groups else IDS["savor_group"]
        child_list = ",\n".join(f"\t\t\t\t{c}" for c in children)
        name_line = f"\n\t\t\tname = {name};" if name else ""
        path_line = f'\n\t\t\tpath = {path};' if path else ""
        objects.append(
            f"""\t\t{gid} /* {name or key} */ = {{
\t\t\tisa = PBXGroup;{name_line}{path_line}
\t\t\tchildren = (
{child_list}
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};"""
        )

    # Rebuild group children carefully with names
    # Root Savor group children: nested folders + Info + Resources items that aren't in nested
    resources_group = nid()
    groups["Savor/Resources"] = resources_group
    group_children["Savor/Resources"] = [IDS["assets"], IDS["samples"]]

    # Ensure Resources is under Savor
    if resources_group not in group_children["Savor"]:
        group_children["Savor"].append(resources_group)
    if IDS["info"] not in group_children["Savor"]:
        group_children["Savor"].append(IDS["info"])

    # Emit all nested groups except top
    for key in sorted(groups.keys(), key=lambda k: (k.count("/"), k)):
        if key == "Savor":
            continue
        name = key.split("/")[-1]
        parent_rel = "/".join(key.split("/")[1:])
        # path is just the folder name for nested groups
        emit_group(key, name, name, group_children.get(key, []))

    emit_group("Savor", "Savor", "Savor", group_children["Savor"])

    objects.append(
        f"""\t\t{IDS["products_group"]} /* Products */ = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{IDS["product_ref"]} /* Savor.app */,
\t\t\t);
\t\t\tname = Products;
\t\t\tsourceTree = "<group>";
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["main_group"]} = {{
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t{IDS["savor_group"]} /* Savor */,
\t\t\t\t{IDS["products_group"]} /* Products */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t}};"""
    )

    # Build phases
    source_builds = ",\n".join(f"\t\t\t\t{build_ids[p]} /* {p.name} in Sources */" for p in swift_files)
    objects.append(
        f"""\t\t{IDS["sources_phase"]} /* Sources */ = {{
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
{source_builds}
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["resources_phase"]} /* Resources */ = {{
\t\t\tisa = PBXResourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t{IDS["assets_build"]} /* Assets.xcassets in Resources */,
\t\t\t\t{IDS["samples_build"]} /* Samples in Resources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["frameworks_phase"]} /* Frameworks */ = {{
\t\t\tisa = PBXFrameworksBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t{IDS["package_product"]} /* SplatCore in Frameworks */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t}};"""
    )

    # Package refs
    objects.append(
        f"""\t\t{IDS["package_ref"]} /* XCLocalSwiftPackageReference "SplatCore" */ = {{
\t\t\tisa = XCLocalSwiftPackageReference;
\t\t\trelativePath = .;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["target_dep"]} /* SplatCore */ = {{
\t\t\tisa = XCSwiftPackageProductDependency;
\t\t\tpackage = {IDS["package_ref"]} /* XCLocalSwiftPackageReference "SplatCore" */;
\t\t\tproductName = SplatCore;
\t\t}};"""
    )

    # Configurations
    common_project = """
\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 18.0;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tSWIFT_VERSION = 6.0;"""

    objects.append(
        f"""\t\t{IDS["project_debug"]} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{{common_project}
\t\t\t\tONLY_ACTIVE_ARCH = YES;
\t\t\t\tSWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;
\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
\t\t\t}};
\t\t\tname = Debug;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["project_release"]} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{{common_project}
\t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
\t\t\t}};
\t\t\tname = Release;
\t\t}};"""
    )

    target_settings = f"""
\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
\t\t\t\tASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tDEVELOPMENT_TEAM = "";
\t\t\t\tENABLE_PREVIEWS = YES;
\t\t\t\tGENERATE_INFOPLIST_FILE = YES;
\t\t\t\tINFOPLIST_FILE = Savor/Info.plist;
\t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = Savor;
\t\t\t\tINFOPLIST_KEY_LSRequiresIPhoneOS = YES;
\t\t\t\tINFOPLIST_KEY_NSPhotoLibraryUsageDescription = "Savor needs access to your videos so you can turn them into 3D gaussian splats.";
\t\t\t\tINFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
\t\t\t\tINFOPLIST_KEY_UILaunchScreen_Generation = YES;
\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations = UIInterfaceOrientationPortrait;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t);
\t\t\t\tMARKETING_VERSION = 0.1.0;
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = app.savor.ios;
\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
\t\t\t\tSUPPORTED_PLATFORMS = "iphoneos iphonesimulator";
\t\t\t\tSUPPORTS_MACCATALYST = NO;
\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
\t\t\t\tSWIFT_STRICT_CONCURRENCY = complete;
\t\t\t\tSWIFT_VERSION = 6.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";"""

    objects.append(
        f"""\t\t{IDS["target_debug"]} /* Debug */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{{target_settings}
\t\t\t}};
\t\t\tname = Debug;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["target_release"]} /* Release */ = {{
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {{{target_settings}
\t\t\t}};
\t\t\tname = Release;
\t\t}};"""
    )

    objects.append(
        f"""\t\t{IDS["project_config_list"]} /* Build configuration list for PBXProject "Savor" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{IDS["project_debug"]} /* Debug */,
\t\t\t\t{IDS["project_release"]} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};"""
    )
    objects.append(
        f"""\t\t{IDS["target_config_list"]} /* Build configuration list for PBXNativeTarget "Savor" */ = {{
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
\t\t\t\t{IDS["target_debug"]} /* Debug */,
\t\t\t\t{IDS["target_release"]} /* Release */,
\t\t\t);
\t\t\tdefaultConfigurationIsVisible = 0;
\t\t\tdefaultConfigurationName = Release;
\t\t}};"""
    )

    objects.append(
        f"""\t\t{IDS["target"]} /* Savor */ = {{
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = {IDS["target_config_list"]} /* Build configuration list for PBXNativeTarget "Savor" */;
\t\t\tbuildPhases = (
\t\t\t\t{IDS["sources_phase"]} /* Sources */,
\t\t\t\t{IDS["frameworks_phase"]} /* Frameworks */,
\t\t\t\t{IDS["resources_phase"]} /* Resources */,
\t\t\t);
\t\t\tbuildRules = (
\t\t\t);
\t\t\tdependencies = (
\t\t\t);
\t\t\tname = Savor;
\t\t\tpackageProductDependencies = (
\t\t\t\t{IDS["target_dep"]} /* SplatCore */,
\t\t\t);
\t\t\tproductName = Savor;
\t\t\tproductReference = {IDS["product_ref"]} /* Savor.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t}};"""
    )

    objects.append(
        f"""\t\t{IDS["project"]} /* Project object */ = {{
\t\t\tisa = PBXProject;
\t\t\tattributes = {{
\t\t\t\tBuildIndependentTargetsInParallel = 1;
\t\t\t\tLastSwiftUpdateCheck = 1600;
\t\t\t\tLastUpgradeCheck = 1600;
\t\t\t}};
\t\t\tbuildConfigurationList = {IDS["project_config_list"]} /* Build configuration list for PBXProject "Savor" */;
\t\t\tdevelopmentRegion = en;
\t\t\thasScannedForEncodings = 0;
\t\t\tknownRegions = (
\t\t\t\ten,
\t\t\t\tBase,
\t\t\t);
\t\t\tmainGroup = {IDS["main_group"]};
\t\t\tminimizedProjectReferenceProxies = 1;
\t\t\tpackageReferences = (
\t\t\t\t{IDS["package_ref"]} /* XCLocalSwiftPackageReference "SplatCore" */,
\t\t\t);
\t\t\tpreferredProjectObjectVersion = 77;
\t\t\tproductRefGroup = {IDS["products_group"]} /* Products */;
\t\t\tprojectDirPath = "";
\t\t\tprojectRoot = "";
\t\t\ttargets = (
\t\t\t\t{IDS["target"]} /* Savor */,
\t\t\t);
\t\t}};"""
    )

    pbx = f"""// !$*UTF8*$!
{{
\tarchiveVersion = 1;
\tclasses = {{
\t}};
\tobjectVersion = 77;
\tobjects = {{

""" + "\n".join(objects) + f"""

\t}};
\trootObject = {IDS["project"]} /* Project object */;
}}
"""

    project_dir = PROJECT
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "project.pbxproj").write_text(pbx)

    scheme_dir = project_dir / "xcshareddata" / "xcschemes"
    scheme_dir.mkdir(parents=True, exist_ok=True)
    scheme = f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme
   LastUpgradeVersion = "1600"
   version = "1.7">
   <BuildAction
      parallelizeBuildables = "YES"
      buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry
            buildForTesting = "YES"
            buildForRunning = "YES"
            buildForProfiling = "YES"
            buildForArchiving = "YES"
            buildForAnalyzing = "YES">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "{IDS["target"]}"
               BuildableName = "Savor.app"
               BlueprintName = "Savor"
               ReferencedContainer = "container:Savor.xcodeproj">
            </BuildableReference>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      shouldUseLaunchSchemeArgsEnv = "YES"
      shouldAutocreateTestPlan = "YES">
   </TestAction>
   <LaunchAction
      buildConfiguration = "Debug"
      selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
      selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
      launchStyle = "0"
      useCustomWorkingDirectory = "NO"
      ignoresPersistentStateOnLaunch = "NO"
      debugDocumentVersioning = "YES"
      debugServiceExtension = "internal"
      allowLocationSimulation = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{IDS["target"]}"
            BuildableName = "Savor.app"
            BlueprintName = "Savor"
            ReferencedContainer = "container:Savor.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction
      buildConfiguration = "Release"
      shouldUseLaunchSchemeArgsEnv = "YES"
      savedToolIdentifier = ""
      useCustomWorkingDirectory = "NO"
      debugDocumentVersioning = "YES">
      <BuildableProductRunnable
         runnableDebuggingMode = "0">
         <BuildableReference
            BuildableIdentifier = "primary"
            BlueprintIdentifier = "{IDS["target"]}"
            BuildableName = "Savor.app"
            BlueprintName = "Savor"
            ReferencedContainer = "container:Savor.xcodeproj">
         </BuildableReference>
      </BuildableProductRunnable>
   </ProfileAction>
   <AnalyzeAction
      buildConfiguration = "Debug">
   </AnalyzeAction>
   <ArchiveAction
      buildConfiguration = "Release"
      revealArchiveInOrganizer = "YES">
   </ArchiveAction>
</Scheme>
"""
    (scheme_dir / "Savor.xcscheme").write_text(scheme)
    print(f"Wrote {project_dir} with {len(swift_files)} Swift sources")


if __name__ == "__main__":
    main()
