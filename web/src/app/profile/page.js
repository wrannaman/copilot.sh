'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast-provider';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth, withAuth } from '@/hooks/use-auth';
import { FileUpload } from '@/components/ui/file-upload';
import { AuthenticatedNav } from '@/components/layout/authenticated-nav';


const API_URL = "/api"

function ProfilePage() {
  const { toast } = useToast();
  const { user, refreshAuth } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      const meta = user.user_metadata || {}
      const first = user.first_name || meta.first_name || meta.given_name || (meta.name ? meta.name.split(' ')[0] : '') || ''
      const last = user.last_name || meta.last_name || meta.family_name || (meta.name ? meta.name.split(' ').slice(1).join(' ') : '') || ''
      setFirstName(first);
      setLastName(last);
    }
  }, [user]);

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ first_name: firstName, last_name: lastName }),
      });

      if (!response.ok) {
        throw new Error('Failed to update profile.');
      }

      if (typeof refreshAuth === 'function') {
        await refreshAuth();
      }

      toast.success('Success', {
        description: 'Your profile has been updated.',
      });
    } catch (err) {
      toast.error('Error', {
        description: err.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUploaded = async (fileInfo) => {
    try {
      const response = await fetch(`${API_URL}/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ avatar: fileInfo.url }),
      });

      if (!response.ok) {
        throw new Error('Failed to update profile with new avatar.');
      }

      await refreshAuth();

      toast.success('File Uploaded', {
        description: `${fileInfo.filename} has been uploaded and your profile has been updated.`,
      });
    } catch (err) {
      toast.error('Error', {
        description: err.message,
      });
    }
  };


  return (
    <>
      <AuthenticatedNav />
      <div className="container mx-auto p-4">
        <h1 className="text-3xl font-bold mb-4">Profile</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Update Your Name</CardTitle>
              <CardDescription>Enter your new name below.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleNameSubmit}>
                <Input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  className="mb-4"
                />
                <Input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  className="mb-4"
                />
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : 'Save'}
                </Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Update Your Photo</CardTitle>
              <CardDescription>Upload a new profile picture.</CardDescription>
            </CardHeader>
            <CardContent>
              <FileUpload
                endpoint={`${API_URL}/upload`}
                onUploadSuccess={handleFileUploaded}
                showUploadedFiles={false}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

export default withAuth(ProfilePage) 