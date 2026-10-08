import unittest, importlib.util, tempfile, hashlib
from unittest.mock import patch
from pathlib import Path

script=Path(__file__).with_name('install-report-export.py')
class InstallerSafety(unittest.TestCase):
    def setUp(self):
        self.assertTrue(script.exists(), 'reviewed installer is missing')
        spec=importlib.util.spec_from_file_location('installer',script)
        self.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.m)
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.live=self.root/'live';self.live.mkdir();self.backup=self.root/'backup';self.backup.mkdir()
        self.manifest=[{'path':'app.js','base':self.sha(b'old'),'head':self.sha(b'new')},{'path':'module.mjs','base':None,'head':self.sha(b'module')}]
        self.stage={'app.js':b'new','module.mjs':b'module'}
        (self.live/'app.js').write_bytes(b'old');(self.live/'app.js').chmod(0o640)
        self.target=lambda p:self.live/p
    def sha(self,b):return hashlib.sha256(b).hexdigest()
    def test_unknown_source_stops_before_backup_or_overwrite(self):
        (self.live/'app.js').write_bytes(b'unknown')
        with self.assertRaises(RuntimeError):self.m.validate_live(self.manifest,self.target)
        self.assertEqual((self.live/'app.js').read_bytes(),b'unknown');self.assertEqual(list(self.backup.iterdir()),[])
    def test_source_symlink_is_rejected(self):
        (self.live/'module.mjs').symlink_to(self.live/'app.js')
        with self.assertRaises(RuntimeError):self.m.validate_live(self.manifest,self.target)
    def test_backup_restore_preserves_bytes_mode_and_new_asset_absence(self):
        before=self.m.backup_files(self.manifest,self.target,self.backup)
        for p,b in self.stage.items():self.m.atomic_write(self.target(p),b)
        self.assertEqual((self.live/'app.js').stat().st_mode & 0o777,0o640)
        self.m.restore_files(before,self.manifest,self.target,self.backup)
        self.assertEqual((self.live/'app.js').read_bytes(),b'old');self.assertEqual((self.live/'app.js').stat().st_mode & 0o777,0o640)
        self.assertFalse((self.live/'module.mjs').exists())
    def test_rollback_does_not_overwrite_unknown_newer_file(self):
        before=self.m.backup_files(self.manifest,self.target,self.backup)
        (self.live/'app.js').write_bytes(b'unknown')
        with self.assertRaises(RuntimeError):self.m.restore_files(before,self.manifest,self.target,self.backup)
        self.assertEqual((self.live/'app.js').read_bytes(),b'unknown')
    def test_corrupt_backup_stops_before_any_rollback(self):
        before=self.m.backup_files(self.manifest,self.target,self.backup)
        for p,b in self.stage.items():self.m.atomic_write(self.target(p),b)
        (self.backup/'files/app.js').write_bytes(b'broken')
        with self.assertRaises(RuntimeError):self.m.restore_files(before,self.manifest,self.target,self.backup)
        self.assertEqual((self.live/'app.js').read_bytes(),b'new');self.assertTrue((self.live/'module.mjs').exists())
    def test_runtime_failure_restores_all_live_files(self):
        self.manifest.append({'path':'supabase/functions/helper.ts','base':None,'head':self.sha(b'edge')})
        self.stage['supabase/functions/helper.ts']=b'edge'
        (self.live/'supabase/functions').mkdir(parents=True)
        calls=[]
        def broken_restart():calls.append('restart');raise RuntimeError('runtime unavailable')
        with self.assertRaises(RuntimeError):self.m.activate(self.manifest,self.stage,self.target,self.backup,broken_restart)
        self.assertEqual((self.live/'app.js').read_bytes(),b'old');self.assertFalse((self.live/'module.mjs').exists())
        self.assertFalse((self.live/'supabase/functions/helper.ts').exists())
        self.assertEqual(len(calls),2)
    def test_dependency_drift_after_install_restores_reviewed_delta(self):
        calls=[]
        def dependencies():
            calls.append('check')
            if len(calls)==2:raise RuntimeError('dependency changed')
        with self.assertRaises(RuntimeError):self.m.activate(self.manifest,self.stage,self.target,self.backup,lambda:None,check_dependencies=dependencies)
        self.assertEqual((self.live/'app.js').read_bytes(),b'old');self.assertFalse((self.live/'module.mjs').exists())
    def test_runtime_retries_temporary_gateway_unavailability(self):
        state='{"Running":true,"Restarting":false}'
        with patch.object(self.m,'docker',side_effect=lambda *args: 'fixed-container' if args[0]=='restart' else state) as docker, patch.object(self.m,'probe_gateway',side_effect=[RuntimeError('FUNCTION_GATEWAY_STATUS_STOP 503'),None]) as probe, patch.object(self.m.time,'sleep'):
            self.m.restart_runtime('fixed-container')
        self.assertEqual(probe.call_count,2)
        self.assertEqual(sum(c.args[0]=='restart' for c in docker.call_args_list),1)
    def test_stage_hash_mismatch_causes_no_backup_or_mutation(self):
        self.stage['app.js']=b'bad download'
        with self.assertRaises(RuntimeError):self.m.activate(self.manifest,self.stage,self.target,self.backup,lambda:None)
        self.assertEqual((self.live/'app.js').read_bytes(),b'old');self.assertEqual(list(self.backup.iterdir()),[])
    def test_index_activates_last_and_runtime_precedes_frontend(self):
        manifest=self.manifest+[{'path':'supabase/functions/helper.ts','base':None,'head':self.sha(b'edge')},{'path':'index.html','base':None,'head':self.sha(b'index')}]
        stage=dict(self.stage,**{'supabase/functions/helper.ts':b'edge','index.html':b'index'})
        (self.live/'supabase/functions').mkdir(parents=True)
        calls=[];real=self.m.atomic_write
        self.m.atomic_write=lambda p,b,**kw:(calls.append(p.relative_to(self.live).as_posix()),real(p,b,**kw))[1]
        self.m.activate(manifest,stage,self.target,self.backup,lambda:calls.append('restart'))
        self.assertEqual(calls[0],'supabase/functions/helper.ts');self.assertEqual(calls[1],'restart');self.assertEqual(calls[-1],'index.html')
if __name__=='__main__':unittest.main()
