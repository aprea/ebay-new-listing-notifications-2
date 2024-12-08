import EbayAuthToken from 'ebay-oauth-nodejs-client';
import axios from 'axios';
import { writeFileSync } from 'fs';
import { Octokit } from '@octokit/rest';

class eBayListingTracker {
  constructor() {
    // Initialize eBay OAuth client
    this.ebayAuthToken = new EbayAuthToken({
      clientId: process.env.EBAY_CLIENT_ID,
      clientSecret: process.env.EBAY_CLIENT_SECRET
    });

    // Initialize other properties
    this.sellerUsername = process.env.SELLER_USERNAME;
    this.processedListingIds = this.getProcessedListingIds();
    this.octokit = new Octokit({ auth: process.env.GH_TOKEN });
    this.owner = process.env.GITHUB_REPOSITORY.split('/')[0];
    this.repo = process.env.GITHUB_REPOSITORY.split('/')[1];
  }

  getProcessedListingIds() {
    const processedIds = process.env.PROCESSED_LISTING_IDS || '';
    return processedIds.split(',').filter(id => id.trim() !== '');
  }

  async getApplicationToken() {
    try {
      // Get application token for API access
      return await this.ebayAuthToken.getApplicationToken('PRODUCTION');
    } catch (error) {
      console.error('Error getting application token:', error.message);
      throw error;
    }
  }

  async getEbayListings(accessToken) {
    try {
      const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU',
        },
        params: {
          q: 'pokemon',
          filter: `sellers:{${process.env.SELLER_USERNAME}}`,
          limit: 50,
          sort: 'newlyListed'
        }
      });

      console.dir(response,{depth:null});

      return response.data.itemSummaries || [];
    } catch (error) {
      console.log(error);
      console.error('Error fetching eBay listings:', error.message);
      return [];
    }
  }

  async updateProcessedListingIds(newListingIds) {
    const updatedIds = Array.from(new Set([
      ...this.processedListingIds, 
      ...newListingIds
    ])).slice(-500).join(',');

    try {
      await this.octokit.actions.updateRepoSecret({
        owner: this.owner,
        repo: this.repo,
        secret_name: 'PROCESSED_LISTING_IDS',
        encrypted_value: Buffer.from(updatedIds).toString('base64')
      });
      console.log('Successfully updated processed listing IDs');
    } catch (error) {
      console.error('Error updating processed listing IDs:', error.message);
    }
  }

  async findAndNotifyNewListings() {
    // Validate required environment variables
    if (!process.env.EBAY_CLIENT_ID || !process.env.SELLER_USERNAME) {
      console.error('Missing required environment variables');
      return { newListings: [], listingDetails: '' };
    }

    try {
      // Get application token
      const applicationToken = await this.getApplicationToken();

      // Fetch current listings
      const currentListings = await this.getEbayListings(applicationToken);

      // Filter out previously processed listings
      const newListings = currentListings.filter(
        listing => !this.processedListingIds.includes(listing.itemId)
      );

      // Prepare listing details for output
      const listingDetails = newListings.map(listing => 
        `Title: ${listing.title}\nURL: ${listing.itemWebUrl}`
      ).join('\n\n');

      // Update processed listing IDs if new listings found
      if (newListings.length > 0) {
        await this.updateProcessedListingIds(
          newListings.map(listing => listing.itemId)
        );
      }

      console.log(`Processed ${newListings.length} new listings`);
      
      return { 
        newListings, 
        listingDetails: listingDetails || 'No new listings found' 
      };
    } catch (error) {
      console.error('Error in finding new listings:', error);
      return { newListings: [], listingDetails: '' };
    }
  }
}

// Run the tracker
const tracker = new eBayListingTracker();
tracker.findAndNotifyNewListings()
  .then(result => {
    // Write result to a file for GitHub Actions to read
    writeFileSync('listing_results.json', JSON.stringify(result));
    process.exit(result.newListings.length > 0 ? 0 : 78);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });