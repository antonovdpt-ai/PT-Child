#!/usr/bin/env python3
"""Preflight checks for the RuStore Android package source and metadata."""
import pathlib
import xml.etree.ElementTree as ET

root = pathlib.Path(__file__).resolve().parents[2]
manifest = root / 'android/app/src/main/AndroidManifest.xml'
tree = ET.parse(manifest)
ns = '{http://schemas.android.com/apk/res/android}'
application = tree.getroot().find('application')
assert application is not None
assert application.attrib[ns + 'allowBackup'] == 'false'
assert application.attrib[ns + 'usesCleartextTraffic'] == 'false'
permissions = [e.attrib[ns+'name'] for e in tree.getroot().findall('uses-permission')]
assert permissions == ['android.permission.INTERNET'], permissions
activities = tree.getroot().findall('application/activity')
assert len(activities) == 1
assert activities[0].attrib[ns+'name'] == 'com.google.androidbrowserhelper.trusted.LauncherActivity'
launch_urls = [m.attrib[ns+'value'] for m in activities[0].findall('meta-data')
    if m.attrib.get(ns+'name') == 'android.support.customtabs.trusted.DEFAULT_URL']
assert launch_urls == ['https://app.fizira.com/']
source = (root / 'android/app/build.gradle').read_text(encoding='utf-8')
assert "applicationId 'com.fizira.app'" in source
assert "versionCode 1" in source
assert "androidbrowserhelper:2.7.3" in source
print('FIZIRA_RUSTORE_STATIC_PREFLIGHT_OK')
